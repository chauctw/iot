// routes/user.route.js
"use strict";
const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

// Middleware kiểm tra đăng nhập tổng quát
const requireLogin = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: "Vui lòng đăng nhập hệ thống." });
    }
    next();
};

// Middleware kiểm tra quyền Quản trị tối cao
const requireAdmin = (req, res, next) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'Admin') {
        return res.status(430).json({ success: false, message: "Bạn không có quyền quản trị tối cao (Yêu cầu Admin)." });
    }
    next();
};

// Các tuyến không cần đăng nhập / kiểm tra trạng thái ban đầu
router.post('/login', userController.login);
router.post('/logout', userController.logout);
router.get('/me', userController.getMe);

// Các tuyến API CRUD bắt buộc phải có quyền Admin bảo mật
router.get('/', requireLogin, requireAdmin, userController.getAllUsers);
router.post('/', requireLogin, requireAdmin, userController.createUser);
router.put('/:id', requireLogin, requireAdmin, userController.updateUser);
router.delete('/:id', requireLogin, requireAdmin, userController.deleteUser);

module.exports = router;