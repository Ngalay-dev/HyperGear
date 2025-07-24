-- CA2_Submission Database Schema
-- Create and use the CA2_Submission database
CREATE DATABASE IF NOT EXISTS CA2_Submission;
USE CA2_Submission;

-- Drop existing tables if they exist (optional)
DROP TABLE IF EXISTS product_discounts;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS cart;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS discounts;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- Create users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    address VARCHAR(255),
    contact VARCHAR(10),
    role VARCHAR(10) DEFAULT 'customer'
);

-- Create categories table
CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- Create products table
CREATE TABLE products (
    idProducts INT AUTO_INCREMENT PRIMARY KEY,
    productName VARCHAR(200) NOT NULL,
    category_id INT,
    price DECIMAL(10,2) NOT NULL,
    quantity INT DEFAULT 0,
    image VARCHAR(500),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Create product_variants table
CREATE TABLE product_variants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    size VARCHAR(10),
    color VARCHAR(50),
    quantity INT DEFAULT 0,
    price_adjustment DECIMAL(10,2) DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(idProducts)
);

-- Create discounts table
CREATE TABLE discounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    type ENUM('percentage', 'fixed_amount', 'free_shipping') NOT NULL,
    value DECIMAL(10,2) NOT NULL,
    min_amount DECIMAL(10,2) DEFAULT 0,
    start_date DATETIME,
    end_date DATETIME,
    is_active BOOLEAN DEFAULT TRUE
);

-- Create orders table
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
    subtotal DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    shipping_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create order_items table
CREATE TABLE order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    product_variant_id INT,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
);

-- Create cart table
CREATE TABLE cart (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    product_variant_id INT,
    quantity INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
);

-- Create reviews table
CREATE TABLE reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    product_id INT,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(idProducts)
);

-- Create product_discounts junction table
CREATE TABLE product_discounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    discount_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(idProducts),
    FOREIGN KEY (discount_id) REFERENCES discounts(id)
);

-- Insert sample categories
INSERT INTO categories (name, description) VALUES
('Men\'s Clothing', 'Athletic wear for men'),
('Women\'s Clothing', 'Athletic wear for women'),
('Accessories', 'Fitness accessories and gear');

-- Insert sample discounts
INSERT INTO discounts (code, name, type, value, min_amount, is_active) VALUES
('WELCOME10', 'Welcome Discount', 'percentage', 10.00, 50.00, TRUE),
('FREESHIP', 'Free Shipping', 'free_shipping', 0.00, 75.00, TRUE),
('SAVE20', 'Save $20', 'fixed_amount', 20.00, 100.00, TRUE);