// controllers/user.controller.js
"use strict";
const db = require('../config/db'); // Giả định db.js của bạn export pool hoặc query của pg
const bcrypt = require('bcryptjs');

// 🔐 Đăng nhập
exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        if (!username || !password) {
            return res.status(400).json({ success: false, message: "Vui lòng nhập đầy đủ tài khoản và mật khẩu." });
        }

        // Truy vấn tìm user từ DB bảng users
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Tài khoản hoặc mật khẩu không chính xác." });
        }

        const user = result.rows[0];
        // Kiểm tra mật khẩu băm
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Tài khoản hoặc mật khẩu không chính xác." });
        }

        // Lưu thông tin vào session
        req.session.user = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role
        };

        return res.json({ success: true, message: "Đăng nhập thành công!", user: req.session.user });
    } catch (error) {
        console.error("Lỗi đăng nhập:", error);
        return res.status(500).json({ success: false, message: "Lỗi hệ thống phía Server." });
    }
};

// 🚪 Đăng xuất
exports.logout = (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, message: "Không thể đăng xuất." });
        res.clearCookie('connect.sid');
        return res.json({ success: true, message: "Đăng xuất thành công." });
    });
};

// 👤 Lấy thông tin User hiện tại đang đăng nhập
exports.getMe = (req, res) => {
    if (req.session.user) {
        return res.json({ loggedIn: true, user: req.session.user });
    }
    return res.json({ loggedIn: false });
};

// 📋 Lấy tất cả danh sách người dùng (Chỉ Admin)
exports.getAllUsers = async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, full_name, role, created_ts FROM users ORDER BY id DESC');
        return res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Không thể lấy danh sách." });
    }
};

// ➕ Thêm người dùng mới
exports.createUser = async (req, res) => {
    const { username, password, full_name, role } = req.body;
    try {
        if (!username || !password || !role) {
            return res.status(400).json({ success: false, message: "Thiếu thông tin bắt buộc." });
        }
        
        // Kiểm tra trùng username
        const checkUser = await db.query('SELECT id FROM users WHERE username = $1', [username]);
        if (checkUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: "Tên tài khoản này đã tồn tại." });
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        await db.query(
            `INSERT INTO users (id, username, password_hash, full_name, role, created_ts) 
             VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM users), $1, $2, $3, $4, NOW())`,
            [username, hash, full_name, role]
        );

        return res.json({ success: true, message: "Thêm tài khoản thành công!" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Lỗi thêm tài khoản." });
    }
};

// ✏️ Sửa thông tin người dùng
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { full_name, role, password } = req.body;
    try {
        let queryStr = `UPDATE users SET full_name = $1, role = $2`;
        let params = [full_name, role, id];

        // Nếu admin điền mật khẩu mới thì tiến hành cập nhật cả mật khẩu
        if (password && password.trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(password, salt);
            queryStr += `, password_hash = $4 WHERE id = $3`;
            params.push(hash);
        } else {
            queryStr += ` WHERE id = $3`;
        }

        await db.query(queryStr, params);
        return res.json({ success: true, message: "Cập nhật tài khoản thành công!" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Lỗi cập nhật." });
    }
};

// ❌ Xóa người dùng
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        if(parseInt(id) === req.session.user.id) {
            return res.status(400).json({ success: false, message: "Bạn không thể tự xóa chính mình!" });
        }
        await db.query('DELETE FROM users WHERE id = $1', [id]);
        return res.json({ success: true, message: "Xóa tài khoản thành công!" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Lỗi khi xóa tài khoản." });
    }
};