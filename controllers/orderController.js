const { validationResult } = require("express-validator");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const User = require("../models/User");
const Guest = require("../models/Guest");
const createTransporter = require("../utils/mailTransporter");
const moment = require("moment");

module.exports = {
  createOrder: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).send({ statusCode: 400, message: errors.array() });
    const { cartId, mode, userId, shippingAddress, billingAddress } = req.body;
    try {
      let order = await Order.findOne({ cart: cartId, status: "Pending" });
      const cart = await Cart.findById(cartId);
      if (!cart)
        return res
          .status(404)
          .send({ statusCode: 404, message: "Cart not found" });
      let user;
      if (mode === "guest") user = await Guest.findById(userId);
      else user = await User.findById(userId);
      if (!user)
        return res
          .status(404)
          .send({ statusCode: 404, message: "User not found" });
      const productsSubTotal = cart.products.reduce(
        (acc, product) => parseInt(acc) + parseInt(product.subTotal),
        0
      );
      const totalAmount =
        productsSubTotal -
        (cart.coupon.value !== undefined
          ? cart.coupon.type === "percent"
            ? Math.round(productsSubTotal * (parseInt(cart.coupon.value) / 100))
            : parseInt(cart.coupon.value)
          : 0);
      const orderObj = {
        couponUsed: cart.coupon.name !== undefined ? cart.coupon.name : "nil",
        cart: cart._id,
        user: user._id,
        products: cart.products,
        mode,
        totalAmount,
        shippingAddress,
        billingAddress,
        expiryDate: new Date().setHours(new Date().getHours() + 48)
      };
      if (order) {
        order = await Order.findOneAndUpdate(
          { cart: cartId, status: "Pending" },
          { $set: { ...orderObj } },
          { new: true }
        );
        return res.send({ statusCode: 200, orderId: order._id });
      }
      order = await Order.create(orderObj);
      res.status(201).send({ statusCode: 201, orderId: order._id });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  changePaymentMethod: async (req, res) => {
    const { orderId } = req.params;
    try {
      if (!orderId)
        return res
          .status(400)
          .send({ statusCode: 400, message: "Order Id not found" });
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res
          .status(400)
          .send({ statusCode: 400, message: errors.array() });
      const { method } = req.body;
      const order = await Order.findById(orderId);
      order.method = method;
      await order.save();
      res.status(202).send({ statusCode: 202, order });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  acceptWesternUnionOrder: async (req, res) => {
    const { orderId } = req.params;
    try {
      if (!orderId)
        return res
          .status(400)
          .send({ statusCode: 400, message: "Order Id not found" });
      const order = await Order.findById(orderId).populate("user", [
        "name",
        "email"
      ]);
      const subTotal = order.products.reduce(
        (acc, product) => parseInt(acc) + parseInt(product.subTotal),
        0
      );
      order.method = "Western Union";
      order.couponUsed = "nil";
      order.totalAmount =
        subTotal >= 200 ? subTotal - subTotal * 0.1 : subTotal;
      order.razorpay_order_id = undefined;
      order.paypal_order_id = undefined;
      order.coinbase_order_code = undefined;
      order.paypal_capture_id = undefined;
      order.razorpay_payment_id = undefined;
      order.paypal_capture_id = undefined;

      const message = {
        from: process.env.ORDER_EMAIL_ID,
        to: order.user.email,
        envelope: {
          from: `MEDEASY <${process.env.ORDER_EMAIL_ID}>`,
          to: order.user.email
        },
        subject: `Medeasy - Steps to process your order.`,
        html: `
          <h1>Dear ${order.user.name}</h1>
          <p>
            Your Order ID - <strong>${
              order._id
            }</strong>, amounting to USD <strong>${
          order.totalAmount
        }</strong>, placed at ${moment(order.createdAt).format(
          "L"
        )} has been accepted succesfully. Please follow the below steps carefully to finish placing the order.<br/></p>
          <p>1) To confirm this order. We would like you to visit <a rel="noopener noreferrer" target="_blank" href="https://www.westernunion.com">Western Union</a> and register if you haven't already</p>
          <br />
          <p>2) Under <strong>Your receiver's country,</strong> enter 'India' and under <strong>Send amount</strong>, enter USD ${
            order.totalAmount
          }.</p><br />
          <p>3) Under <strong>How does your receiver want the money,</strong> select Cash Pick-up.</p><br/>
          <p>4) Choose your preferred method of payment: Be it Credit card, debit card or Bank account.</p><br/>
          <p>5) On the <strong>receiver's information</strong> page, fill in the below-mentioned details:</p><br/>
          
          <p><strong>Receiver???s first name:</strong> Harish</p>
          <p><strong>Receiver???s last name:</strong> Balasubramanian</p>
          <p><strong>Street address:</strong> Sai Ayush Puja Avenue, Thiruvengadam Nagar, Perungudi</p>
          <p><strong>City:</strong> Chennai</p>
          <p><strong>State:</strong> Tamil Nadu</p>
          <p><strong>Pin code:</strong> 600096</p>
          <p><strong>Phone:</strong> (91)9677928794</p>
          <br/>

          <p>6) Once the payment is done, send a reply mail containing a screenshot of the payment receipt (Reference ID and your name in it) to <a href="mailto:${
            process.env.ORDER_EMAIL_ID
          }">${process.env.ORDER_EMAIL_ID}</a></p><br/>
          <p>Shortly after, a confirmation email will be sent to you along with the tracking number. :) 
          .</p><br />
          <p>The package itself will be delivered to your very doorstep within ${moment(
            order.paidAt
          )
            .add(12, "days")
            .format("L")}-${moment(order.paidAt)
          .add(14, "days")
          .format("L")}} business days through the USPS.</p>
          <br/><br/>
          <h4>Best Regards</h4>
          <h3>Team <a href='https://${
            process.env.MEDEASY_WEBSITE
          }'>Medeasy</a></h3>
        `
      };
      await order.save();
      const transporter = createTransporter(process.env.ORDER_EMAIL_ID);
      await transporter.sendMail(message);
      res.status(202).send({ statusCode: 202, message: "Accepted" });
    } catch (err) {
      if (err.name === "CastError")
        return res
          .status(400)
          .send({ statusCode: 400, message: "Invalid Order Id" });
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  changePaymentStatus: async (req, res) => {
    const { orderId } = req.params;
    try {
      if (!orderId)
        return res
          .status(400)
          .send({ statusCode: 400, message: "Order Id not found" });
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res
          .status(400)
          .send({ statusCode: 400, message: errors.array() });
      const { status } = req.body;
      const order = await Order.findById(orderId);
      order.status = status;
      if (status === "Success") {
        await Cart.findByIdAndDelete(order.cart);
        order.cart = null;
        await order.save();
        delete order.cart;
      }
      res.status(202).send({ statusCode: 202, order });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  changeTrackingStatus: async (req, res) => {
    const { orderId } = req.params;
    try {
      if (!orderId)
        return res
          .status(400)
          .send({ statusCode: 400, message: "Order Id not found" });
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res
          .status(400)
          .send({ statusCode: 400, message: errors.array() });
      const { trackingId } = req.body;
      const order = await Order.findById(orderId).populate("user", [
        "name",
        "email"
      ]);
      order.trackingId = trackingId;
      await order.save();
      const message = {
        from: process.env.ORDER_EMAIL_ID,
        to: order.user.email,
        envelope: {
          from: `MEDEASY <${process.env.ORDER_EMAIL_ID}>`,
          to: order.user.email
        },
        subject: "Update on your Shipment",
        html: `
          <h1>Dear ${order.user.name}</h1>
          <p>
            Your Order ID - <strong>${
              order._id
            }</strong>, amounting to USD <strong>${
          order.totalAmount
        }</strong>, placed at ${moment(order.paidAt).format(
          "L"
        )} has been shipped succesfully. <br/>
            Shipment Tracking Id - <strong>${trackingId}</strong><br />
            Estimated Delivery Date - <strong>${moment(order.paidAt)
              .add(10, "days")
              .format("L")}</strong> to <strong>${moment(order.paidAt)
          .add(16, "days")
          .format("L")}</strong><br />
            Please click the following link below to track your shipment.
          <p>
          <a href='https://t.17track.net/en#nums=${trackingId}'>Track your Shipment</a><br />
          <p>We thank you for believing in our service.</p>
          <br/><br/>
          <h4>With Regards</h4>
          <h3>Medeasy @ <a href='https://${
            process.env.MEDEASY_WEBSITE
          }'>Medeasyonline.com</a></h3>
        `
      };
      const transporter = createTransporter(process.env.ORDER_EMAIL_ID);
      const response = await transporter.sendMail(message);
      res.status(202).send({ statusCode: 202, order });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  fetchOrders: async (req, res) => {
    try {
      await Order.deleteMany({
        status: "Pending",
        method: { $ne: "bitcoin" },
        expiryDate: { $lte: new Date().getTime() }
      });
      const orders = await Order.find({}).populate("user", ["name", "email"]);
      res.send({ statusCode: 200, orders });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  async fetchOrderById(req, res) {
    const { orderId } = req.params;
    if (!orderId)
      return res
        .status(400)
        .send({ statusCode: 400, message: "Order Id is required" });
    try {
      const order = await Order.findById(orderId);
      if (!order)
        return res
          .status(404)
          .send({ statusCode: 404, message: "Order not found" });
      res.send({ statusCode: 200, order });
    } catch (err) {
      if (err.name === "CastError")
        return res
          .status(404)
          .send({ statusCode: 400, message: "Invalid Order Id" });
    }
  },

  fetchOrdersByUserId: async (req, res) => {
    const user = req.user;
    try {
      const orders = await Order.find({ user: user._id, status: "Success" });
      res.send({ statusCode: 200, orders });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  fetchOrderSingleByUserId: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).send({ statusCode: 400, message: errors.array() });
    try {
      const { userId, orderId } = req.body;
      const order = await Order.findOne({
        user: userId,
        _id: orderId,
        status: "Pending"
      });
      if (!order)
        return res
          .status(404)
          .send({ statusCode: 404, message: "Order not found" });
      return res.status(202).send({ statusCode: 202, order });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  },

  deleteOrderById: async (req, res) => {
    const { orderId } = req.params;
    if (!orderId)
      return res
        .status(400)
        .send({ statusCode: 400, message: "Order ID not found" });
    try {
      const order = await Order.findByIdAndDelete(orderId);
      if (!order)
        return res
          .status(404)
          .send({ statusCode: 404, message: "Order not found" });
      res.status(202).send({ statusCode: 202, order });
    } catch (err) {
      res.status(500).send({ statusCode: 500, message: "Server Error" });
    }
  }
};
