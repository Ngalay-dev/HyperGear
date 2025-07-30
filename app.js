const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const crypto = require('crypto');
const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); 
    }
});

const upload = multer({ storage: storage });

const connection = mysql.createConnection({
    host: 'c237-boss.mysql.database.azure.com',
    user: 'c237boss',
    password: 'c237boss!',
    database: 'c237_005_team2'
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));

//TO DO: Insert code for Session Middleware below 
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } 
}));

app.use(flash());

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Enhanced middleware for form validation using SQL
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact, role } = req.body;

    if (!username || !email || !password || !address || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }
    
    if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters long.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    // Email format validation (basic regex)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        req.flash('error', 'Please enter a valid email address.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    // Username validation (alphanumeric and underscore only)
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username) || username.length < 3) {
        req.flash('error', 'Username must be at least 3 characters and contain only letters, numbers, and underscores.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    // Contact number validation (basic)
    const contactRegex = /^[\d\s\-\+\(\)]+$/;
    if (!contactRegex.test(contact) || contact.length < 8) {
        req.flash('error', 'Please enter a valid contact number.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    // Check if email already exists using SQL
    const checkEmailSql = 'SELECT COUNT(*) as count FROM users WHERE email = ?';
    connection.query(checkEmailSql, [email], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            req.flash('error', 'An error occurred. Please try again.');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }

        if (results[0].count > 0) {
            req.flash('error', 'An account with this email already exists.');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }

        // Check if username already exists using SQL
        const checkUsernameSql = 'SELECT COUNT(*) as count FROM users WHERE username = ?';
        connection.query(checkUsernameSql, [username], (err, results) => {
            if (err) {
                console.error('Database error:', err);
                req.flash('error', 'An error occurred. Please try again.');
                req.flash('formData', req.body);
                return res.redirect('/register');
            }

            if (results[0].count > 0) {
                req.flash('error', 'This username is already taken. Please choose another.');
                req.flash('formData', req.body);
                return res.redirect('/register');
            }

            // All validations passed, proceed to next middleware
            next();
        });
    });
};

// Define routes
app.get('/',  (req, res) => {
    connection.query('SELECT * FROM products',(error, results)=>{
        if (error) throw error;
        res.render('index', {user: req.session.user,results: results} );
    });
    
});

// Route for subcategory
app.get('/category/:category/:subcategory', checkAuthenticated, (req, res) => {
    const category = req.params.category;
    let subcategory = req.params.subcategory;
    subcategory = subcategory.replace(/-/g, ' '); 
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        const categories = {};
        const parents = allCategories.filter(cat => cat.parent_id === null);
        parents.forEach(parent => {
            const children = allCategories.filter(cat => cat.parent_id === parent.id);
            categories[parent.name.toLowerCase()] = children;
        });
        const query = 'SELECT p.*, c.name as category_name FROM products p JOIN categories c ON p.category_id = c.id WHERE c.name = ?';
        connection.query(query, [subcategory], (error, results) => {
            if (error) throw error;
            results.forEach(product => {
                product.price = Number(product.price);
            });
            res.render('category', { 
                products: results, 
                user: req.session.user,
                category: category,
                subcategory: subcategory,
                categories: categories
            });
        });
    });
});

// Route for main category
app.get('/category/:category', checkAuthenticated, (req, res) => {
    const category = req.params.category;
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        const categories = {};
        const parents = allCategories.filter(cat => cat.parent_id === null);
        parents.forEach(parent => {
            const children = allCategories.filter(cat => cat.parent_id === parent.id);
            categories[parent.name.toLowerCase()] = children;
        });
        const query = 'SELECT p.*, c.name as category_name FROM products p JOIN categories c ON p.category_id = c.id JOIN categories parent ON c.parent_id = parent.id WHERE parent.name = ?';
        connection.query(query, [category], (error, results) => {
            if (error) throw error;
            results.forEach(product => {
                product.price = Number(product.price);
            });
            res.render('category', { 
                products: results, 
                user: req.session.user,
                category: category,
                subcategory: 'All',
                categories: categories
            });
        });
    });
});

app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM products', (error, results) => {
      if (error) throw error;
      res.render('inventory', { products: results, user: req.session.user });
    });
});

// Update user route - Admin only
app.post('/editUser/:userId', checkAuthenticated, checkAdmin, (req, res) => {
    const userId = req.params.userId;
    const { username, email, address, contact, role } = req.body;
    
    // Server-side validation
    if (!username || !email || !address || !contact || !role) {
        req.flash('error', 'All fields are required');
        return res.redirect(`/editUser/${userId}`);
    }
    
    // Validate role
    if (!['user', 'customer', 'admin'].includes(role)) {
        req.flash('error', 'Invalid role specified');
        return res.redirect(`/editUser/${userId}`);
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        req.flash('error', 'Please enter a valid email address');
        return res.redirect(`/editUser/${userId}`);
    }
    
    // Contact validation
    const contactRegex = /^[\d\s\-\+\(\)]+$/;
    if (!contactRegex.test(contact) || contact.length < 8) {
        req.flash('error', 'Please enter a valid contact number');
        return res.redirect(`/editUser/${userId}`);
    }
    
    // Get current user info to check for admin role changes
    connection.query('SELECT username, role FROM users WHERE userId = ?', [userId], (error, currentResults) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Database error occurred');
            return res.redirect(`/editUser/${userId}`);
        }
        
        if (currentResults.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/manageUsers');
        }
        
        const currentUser = currentResults[0];
        
        // Prevent admin from changing their own role
        if (userId == req.session.user.userId && role !== 'admin') {
            req.flash('error', 'You cannot change your own admin role');
            return res.redirect(`/editUser/${userId}`);
        }
        
        // Check for duplicate username (excluding current user)
        connection.query('SELECT userId FROM users WHERE username = ? AND userId != ?', [username, userId], (error, usernameResults) => {
            if (error) {
                console.error('Database error:', error);
                req.flash('error', 'Error checking username');
                return res.redirect(`/editUser/${userId}`);
            }
            
            if (usernameResults.length > 0) {
                req.flash('error', 'Username is already taken');
                return res.redirect(`/editUser/${userId}`);
            }
            
            // Check for duplicate email (excluding current user)
            connection.query('SELECT userId FROM users WHERE email = ? AND userId != ?', [email, userId], (error, emailResults) => {
                if (error) {
                    console.error('Database error:', error);
                    req.flash('error', 'Error checking email');
                    return res.redirect(`/editUser/${userId}`);
                }
                
                if (emailResults.length > 0) {
                    req.flash('error', 'Email is already taken');
                    return res.redirect(`/editUser/${userId}`);
                }
                
                // Additional check: prevent removal of the last admin
                if (currentUser.role === 'admin' && role !== 'admin') {
                    connection.query('SELECT COUNT(*) as adminCount FROM users WHERE role = "admin"', (countError, countResults) => {
                        if (countError) {
                            console.error('Database error:', countError);
                            req.flash('error', 'Database error occurred');
                            return res.redirect(`/editUser/${userId}`);
                        }
                        
                        if (countResults[0].adminCount <= 1) {
                            req.flash('error', 'Cannot remove admin role from the last administrator');
                            return res.redirect(`/editUser/${userId}`);
                        }
                        
                        // Proceed with update
                        performUserUpdate(userId, username, email, address, contact, role, currentUser.username, req, res);
                    });
                } else {
                    // Proceed with update
                    performUserUpdate(userId, username, email, address, contact, role, currentUser.username, req, res);
                }
            });
        });
    });
});

// Helper function to perform user update
const performUserUpdate = (userId, username, email, address, contact, role, oldUsername, req, res) => {
    const updateSql = 'UPDATE users SET username = ?, email = ?, address = ?, contact = ?, role = ? WHERE userId = ?';
    connection.query(updateSql, [username, email, address, contact, role, userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Failed to update user');
            return res.redirect(`/editUser/${userId}`);
        }
        
        // Update session if admin edited their own account
        if (userId == req.session.user.userId) {
            req.session.user.username = username;
            req.session.user.email = email;
            req.session.user.address = address;
            req.session.user.contact = contact;
            req.session.user.role = role;
        }
        
        req.flash('success', `User "${oldUsername}" updated successfully`);
        res.redirect('/manageUsers');
    });
};

// Register route
app.get('/register', (req, res) => {
    res.render('auth/register', { 
        messages: req.flash('error'), 
        formData: req.flash('formData')[0],
        user: req.session.user || null,
        categories: {}
    });
});

app.post('/register', validateRegistration, (req, res) => {

    const { username, email, password, address, contact, role } = req.body;

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            throw err;
        }
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    res.render('auth/login', { 
        messages: req.flash('success'), 
        errors: req.flash('error'),
        user: req.session.user || null,
        categories: {}
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }
    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    connection.query(sql, [email, password], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            req.session.user = results[0]; 
            req.flash('success', 'Login successful!');
            if(req.session.user.role == 'user')
                res.redirect('/shopping');
            else
                res.redirect('/inventory');
        } else {
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

app.get('/shopping', checkAuthenticated, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM products', (error, results) => {
        if (error) throw error;
        res.render('shopping', { user: req.session.user, products: results });
      });
});

app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;
    connection.query('SELECT * FROM products WHERE idProducts = ?', [productId], (error, results) => {
        if (error) throw error;
        if (results.length > 0) {
            const product = results[0];
            if (!req.session.cart) {
                req.session.cart = [];
            }
            const existingItem = req.session.cart.find(item => item.idProducts === productId);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                req.session.cart.push({
                    idProducts: product.idProducts,
                    productName: product.productName,
                    price: product.price,
                    quantity: quantity,
                    image: product.image
                });
            }
            res.redirect('/cart');
        } else {
            res.status(404).send("Product not found");
        }
    });
});

app.get('/cart', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    
    // Get hierarchical categories for navbar (same structure as other routes)
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        
        // Structure categories for navbar
        const categories = {};
        const parents = allCategories.filter(cat => cat.parent_id === null);
        
        parents.forEach(parent => {
            const children = allCategories.filter(cat => cat.parent_id === parent.id);
            categories[parent.name.toLowerCase()] = children;
        });
        
        res.render('cart', { 
            cart, 
            user: req.session.user, 
            categories,
            messages: req.flash()
        });
    });
});

// NEW ROUTES FOR PLUS/MINUS BUTTONS
app.post('/cart/increase/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    if (!req.session.cart) return res.redirect('/cart');
    const item = req.session.cart.find(p => p.idProducts === productId);
    if (item) {
        item.quantity += 1;
    }
    res.redirect('/cart');
});

app.post('/cart/decrease/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    if (!req.session.cart) return res.redirect('/cart');

    const index = req.session.cart.findIndex(p => p.idProducts === productId);

    if (index !== -1) {
        if (req.session.cart[index].quantity > 1) {
            req.session.cart[index].quantity -= 1;
        } else {
            // remove item if quantity is 1
            req.session.cart.splice(index, 1);
        }
    }
    res.redirect('/cart');
});
// END PLUS/MINUS

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Profile route - User profile management
app.get('/profile', checkAuthenticated, (req, res) => {
    // Get the current user's information from the database
    const userId = req.session.user.userId;
    
    connection.query('SELECT userId, username, email, address, contact, role FROM users WHERE userId = ?', [userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Error loading profile');
            return res.redirect('/shopping');
        }
        
        if (results.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/shopping');
        }
        
        res.render('profile', {
            user: results[0],
            categories: {},
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

// Update profile route
app.post('/profile', checkAuthenticated, (req, res) => {
    const { username, address, contact } = req.body;
    const userId = req.session.user.userId;
    
    // Basic validation (removed email since it's no longer editable)
    if (!username || !address || !contact) {
        req.flash('error', 'All fields are required');
        return res.redirect('/profile');
    }
    
    // Check if username is already taken by another user
    connection.query('SELECT userId FROM users WHERE username = ? AND userId != ?', [username, userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Error updating profile');
            return res.redirect('/profile');
        }
        
        if (results.length > 0) {
            req.flash('error', 'Username is already taken');
            return res.redirect('/profile');
        }
        
        // Update the user's profile (removed email from update)
        const updateSql = 'UPDATE users SET username = ?, address = ?, contact = ? WHERE userId = ?';
        connection.query(updateSql, [username, address, contact, userId], (error, results) => {
            if (error) {
                console.error('Database error:', error);
                req.flash('error', 'Error updating profile');
                return res.redirect('/profile');
            }
            
            // Update session data (keep email unchanged)
            req.session.user.username = username;
            req.session.user.address = address;
            req.session.user.contact = contact;
            
            req.flash('success', 'Profile updated successfully');
            res.redirect('/profile');
        });
    });
});

// Change password route
app.post('/change-password', checkAuthenticated, (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.user.userId;
    
    // Basic validation
    if (!currentPassword || !newPassword || !confirmPassword) {
        req.flash('error', 'All password fields are required');
        return res.redirect('/profile');
    }
    
    // Check if new passwords match
    if (newPassword !== confirmPassword) {
        req.flash('error', 'New passwords do not match');
        return res.redirect('/profile');
    }
    
    // Check password length
    if (newPassword.length < 6) {
        req.flash('error', 'New password must be at least 6 characters long');
        return res.redirect('/profile');
    }
    
    // Verify current password
    connection.query('SELECT password FROM users WHERE userId = ?', [userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Error changing password');
            return res.redirect('/profile');
        }
        
        if (results.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/profile');
        }
        
        // Check if current password is correct (using SHA1 hash)
        connection.query('SELECT userId FROM users WHERE userId = ? AND password = SHA1(?)', [userId, currentPassword], (error, results) => {
            if (error) {
                console.error('Database error:', error);
                req.flash('error', 'Error changing password');
                return res.redirect('/profile');
            }
            
            if (results.length === 0) {
                req.flash('error', 'Current password is incorrect');
                return res.redirect('/profile');
            }
            
            // Update password
            connection.query('UPDATE users SET password = SHA1(?) WHERE userId = ?', [newPassword, userId], (error, results) => {
                if (error) {
                    console.error('Database error:', error);
                    req.flash('error', 'Error changing password');
                    return res.redirect('/profile');
                }
                
                req.flash('success', 'Password changed successfully');
                res.redirect('/profile');
            });
        });
    });
});

// Orders route - Display user's order history
app.get('/orders', checkAuthenticated, (req, res) => {
    const userId = req.session.user.userId;
    
    // Get user's orders with pagination support
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    // Get total count of orders
    const countSql = 'SELECT COUNT(*) as total FROM orders WHERE userId = ?';
    connection.query(countSql, [userId], (error, countResults) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Error loading orders');
            return res.redirect('/shopping');
        }
        
        const totalOrders = countResults[0].total;
        const totalPages = Math.ceil(totalOrders / limit);
        
        // Get orders for current page
        const ordersSql = `
            SELECT o.*, 
                   COUNT(oi.id) as item_count,
                   GROUP_CONCAT(DISTINCT p.productName SEPARATOR ', ') as product_names
            FROM orders o 
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN product_variants pv ON oi.product_variant_id = pv.id
            LEFT JOIN products p ON pv.idProducts = p.idProducts
            WHERE o.userId = ? 
            GROUP BY o.id
            ORDER BY o.created_at DESC 
            LIMIT ? OFFSET ?
        `;
        
        connection.query(ordersSql, [userId, limit, offset], (error, orderResults) => {
            if (error) {
                console.error('Database error:', error);
                req.flash('error', 'Error loading orders');
                return res.redirect('/shopping');
            }
            
            // Get hierarchical categories for navbar
            connection.query('SELECT * FROM categories', (error, allCategories) => {
                if (error) throw error;
                
                const categories = {};
                const parents = allCategories.filter(cat => cat.parent_id === null);
                
                parents.forEach(parent => {
                    const children = allCategories.filter(cat => cat.parent_id === parent.id);
                    categories[parent.name.toLowerCase()] = children;
                });
                
                res.render('orders', {
                    orders: orderResults,
                    user: req.session.user,
                    categories,
                    messages: req.flash(),
                    pagination: {
                        currentPage: page,
                        totalPages: totalPages,
                        totalOrders: totalOrders,
                        hasNext: page < totalPages,
                        hasPrev: page > 1
                    }
                });
            });
        });
    });
});

// Cancel order route
app.post('/orders/:orderId/cancel', checkAuthenticated, (req, res) => {
    const orderId = req.params.orderId;
    const userId = req.session.user.userId;
    
    // First, verify the order belongs to the user and can be cancelled
    const checkOrderSql = `
        SELECT id, order_number, status, total_amount 
        FROM orders 
        WHERE id = ? AND userId = ?
    `;
    
    connection.query(checkOrderSql, [orderId, userId], (error, orderResults) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Error processing cancellation request');
            return res.redirect('/orders');
        }
        
        if (orderResults.length === 0) {
            req.flash('error', 'Order not found or access denied');
            return res.redirect('/orders');
        }
        
        const order = orderResults[0];
        
        // Check if order can be cancelled (only pending and processing orders)
        if (order.status !== 'pending' && order.status !== 'processing') {
            req.flash('error', `Cannot cancel order ${order.order_number}. Orders can only be cancelled when they are pending or processing.`);
            return res.redirect('/orders');
        }
        
        // Update order status to cancelled
        const cancelSql = 'UPDATE orders SET status = ? WHERE id = ?';
        connection.query(cancelSql, ['cancelled', orderId], (error, updateResult) => {
            if (error) {
                console.error('Database error:', error);
                req.flash('error', 'Error cancelling order');
                return res.redirect('/orders');
            }
            
            // Restore product quantities (get order items and update product stock)
            const getItemsSql = `
                SELECT oi.quantity, p.idProducts
                FROM order_items oi
                LEFT JOIN product_variants pv ON oi.product_variant_id = pv.id
                LEFT JOIN products p ON pv.idProducts = p.idProducts
                WHERE oi.order_id = ?
            `;
            
            connection.query(getItemsSql, [orderId], (error, itemResults) => {
                if (error) {
                    console.error('Error fetching order items:', error);
                    // Order is cancelled but stock won't be restored
                    req.flash('success', `Order ${order.order_number} has been cancelled successfully. Please contact support regarding stock restoration.`);
                    return res.redirect('/orders');
                }
                
                // Update product quantities
                const updatePromises = itemResults.map(item => {
                    return new Promise((resolve, reject) => {
                        if (item.idProducts) {
                            const updateStockSql = 'UPDATE products SET quantity = quantity + ? WHERE idProducts = ?';
                            connection.query(updateStockSql, [item.quantity, item.idProducts], (error) => {
                                if (error) {
                                    console.error('Error restoring stock for product:', item.idProducts, error);
                                }
                                resolve(); // Continue even if individual stock update fails
                            });
                        } else {
                            resolve();
                        }
                    });
                });
                
                Promise.all(updatePromises).then(() => {
                    req.flash('success', `Order ${order.order_number} has been cancelled successfully. Stock quantities have been restored.`);
                    res.redirect('/orders');
                }).catch((error) => {
                    console.error('Error updating stock:', error);
                    req.flash('success', `Order ${order.order_number} has been cancelled successfully.`);
                    res.redirect('/orders');
                });
            });
        });
    });
});

app.get('/product/:id', checkAuthenticated, (req, res) => {
  // Extract the product ID from the request parameters
  const productId = req.params.id;

  // Fetch data from MySQL based on the product ID
  connection.query('SELECT * FROM products WHERE idProducts = ?', [productId], (error, results) => {
      if (error) throw error;

      // Check if any product with the given ID was found
      if (results.length > 0) {
          // Render HTML page with the product data
          res.render('product', { product: results[0], user: req.session.user  });
      } else {
          // If no product with the given ID was found, render a 404 page or handle it accordingly
          res.status(404).send('Product not found');
      }
  });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', {
        user: req.session.user,
        categories: {}
    }); 
});

app.post('/addProduct', upload.single('image'),  (req, res) => {
    // Extract product data from the request body
    const { name, quantity, price} = req.body;
    let image;
    if (req.file) {
        image = req.file.filename;
    } else {
        image = null;
    }
    const sql = 'INSERT INTO products (productName, quantity, price, image, category_id) VALUES (?, ?, ?, ?, ?)';
    // Insert the new product into the database
    connection.query(sql , [name, quantity, price, image, 1], (error, results) => {
        if (error) {
            console.error("Error adding product:", error);
            res.status(500).send('Error adding product');
        } else {
            res.redirect('/inventory');
        }
    });
});

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE idProducts = ?';

    // Fetch data from MySQL based on the product ID
    connection.query(sql , [productId], (error, results) => {
        if (error) throw error;
        if (results.length > 0) {
            // Render HTML page with the product data
            res.render('updateProduct', { product: results[0] });
        } else {
            res.status(404).send('Product not found');
        }
    });
});

app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), (req, res) => {
    const productId = req.params.id;
    const { name, quantity, price } = req.body;
    let image  = req.body.currentImage; //retrieve current image filename
    if (req.file) { //if new image is uploaded
        image = req.file.filename; // set image to be new image filename
    } 
    const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image =? WHERE idProducts = ?';
    connection.query(sql, [name, quantity, price, image, productId], (error, results) => {
        if (error) {
            console.error("Error updating product:", error);
            res.status(500).send('Error updating product');
        } else {
            res.redirect('/inventory');
        }
    });
});

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const productId = req.params.id;
    connection.query('DELETE FROM products WHERE idProducts = ?', [productId], (error, results) => {
        if (error) {
            console.error("Error deleting product:", error);
            res.status(500).send('Error deleting product');
        } else {
            res.redirect('/inventory');
        }
    });
});

// CHECKOUT ROUTES
app.get('/checkout', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    if (cart.length === 0) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/cart');
    }
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('checkout', { cart, total, user: req.session.user });
});

app.post('/checkout', checkAuthenticated, (req, res) => {
    const { paymentMethod, cardNumber, expiry, cvv } = req.body;
    const cart = req.session.cart || [];
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (paymentMethod === 'Credit/Debit Card') {
        if (!cardNumber || !expiry || !cvv) {
            req.flash('error', 'Please fill in all credit card details.');
            return res.redirect('/checkout');
        }
    }

    const orderId = 'ORD' + Date.now();
    const trackingNumber = 'TRK' + Math.floor(Math.random() * 1000000);

    req.session.lastOrder = {
        orderId,
        trackingNumber,
        total,
        paymentMethod,
        items: cart,
        cardNumber: paymentMethod === 'Credit/Debit Card' ? '**** **** **** ' + cardNumber.slice(-4) : null
    };

    req.session.cart = [];
    res.redirect('/receipt');
});

app.get('/receipt', checkAuthenticated, (req, res) => {
    const order = req.session.lastOrder;
    if (!order) {
        return res.redirect('/shopping');
    }
    res.render('receipt', { order, user: req.session.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
