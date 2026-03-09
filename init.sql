-- 开启加密扩展（可选，如果你的密码是加密存储的建议保留）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. 用户表 (新增了 balance 和 rate)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    status BOOLEAN DEFAULT true,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    rate DECIMAL(10, 2) DEFAULT 1.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- 2. 电话号码表
CREATE TABLE phone_numbers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    cover_name VARCHAR(100),
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- 3. 电话设置表
CREATE TABLE phone_settings (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(50) NOT NULL,
    digit INTEGER NOT NULL,
    content TEXT,
    redirect_to VARCHAR(50),
    cover_number BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);