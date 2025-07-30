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
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));

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
    const { username, email, password, address, contact } = req.body;

    // Basic field validation
    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    
    // Password length validation
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

// Helper function to perform the actual role update
const performRoleUpdate = (userId, newRole, username, req, res) => {
    connection.query('UPDATE users SET role = ? WHERE userId = ?', [newRole, userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Failed to update user role');
        } else {
            req.flash('success', `User "${username}" role updated to "${newRole}" successfully`);
        }
        res.redirect('/manageUsers');
    });
};

// Helper function to perform the actual user deletion
const performUserDeletion = (userId, username, req, res) => {
    // Use SQL transaction for safe deletion
    connection.beginTransaction((transactionError) => {
        if (transactionError) {
            console.error('Transaction start error:', transactionError);
            req.flash('error', 'Database transaction failed');
            return res.redirect('/manageUsers');
        }
        
        // Delete user using SQL
        const deleteSql = 'DELETE FROM users WHERE userId = ?';
        connection.query(deleteSql, [userId], (error, results) => {
            if (error) {
                return connection.rollback(() => {
                    console.error('Database error:', error);
                    req.flash('error', 'Failed to delete user account');
                    res.redirect('/manageUsers');
                });
            }
            
            if (results.affectedRows === 0) {
                return connection.rollback(() => {
                    req.flash('error', 'User not found or already deleted');
                    res.redirect('/manageUsers');
                });
            }
            
            // Commit the transaction
            connection.commit((commitError) => {
                if (commitError) {
                    return connection.rollback(() => {
                        console.error('SQL commit error:', commitError);
                        req.flash('error', 'Failed to complete user deletion');
                        res.redirect('/manageUsers');
                    });
                }
                
                req.flash('success', `User "${username}" (ID: ${userId}) deleted successfully`);
                res.redirect('/manageUsers');
            });
        });
    });
};

// Helper function to render receipt
const renderReceipt = (order, items, req, res) => {
    // Get hierarchical categories for navbar
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        
        const categories = {};
        const parents = allCategories.filter(cat => cat.parent_id === null);
        
        parents.forEach(parent => {
            const children = allCategories.filter(cat => cat.parent_id === parent.id);
            categories[parent.name.toLowerCase()] = children;
        });
        
        res.render('receipt', {
            order: order,
            items: items,
            user: req.session.user,
            categories,
            messages: req.flash()
        });
    });
};

// Define routes
app.get('/', (req, res) => {
    connection.query('SELECT * FROM products', (error, results) => {
        if (error) throw error;
        res.render('index', {
            user: req.session.user,
            results: results,
            categories: {}
        });
    });
});

// Route for subcategory (e.g., /category/equipment/balls)
app.get('/category/:category/:subcategory', checkAuthenticated, (req, res) => {
    const category = req.params.category;
    const subcategory = req.params.subcategory;
    
    // Get hierarchical categories for navbar
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        
        // Structure categories for navbar
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

// Route for main category (e.g., /category/equipment)
app.get('/category/:category', checkAuthenticated, (req, res) => {
    const category = req.params.category;
    
    // Get hierarchical categories for navbar
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        
        // Structure categories for navbar
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
    // Get search and filter parameters from query string
    const searchTerm = req.query.search || '';
    const stockFilter = req.query.stock || 'all';
    const sortBy = req.query.sort || 'productName';
    const sortOrder = req.query.order || 'ASC';
    
    // Build the SQL query with filtering
    let sqlQuery = 'SELECT * FROM products WHERE 1=1';
    let queryParams = [];
    
    // Add search filter
    if (searchTerm) {
        sqlQuery += ' AND productName LIKE ?';
        queryParams.push(`%${searchTerm}%`);
    }
    
    // Add stock filter
    switch (stockFilter) {
        case 'instock':
            sqlQuery += ' AND quantity > 0';
            break;
        case 'lowstock':
            sqlQuery += ' AND quantity > 0 AND quantity <= 5';
            break;
        case 'outofstock':
            sqlQuery += ' AND quantity = 0';
            break;
    }
    
    // Add sorting
    const validSortFields = ['productName', 'quantity', 'price', 'idProducts'];
    const validSortOrders = ['ASC', 'DESC'];
    
    if (validSortFields.includes(sortBy) && validSortOrders.includes(sortOrder.toUpperCase())) {
        sqlQuery += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
    }
    
    // Execute the query
    connection.query(sqlQuery, queryParams, (error, results) => {
        if (error) {
            console.error('Database error:', error);
            return res.status(500).send('Database error');
        }
        
        // Convert price to number for each product
        results.forEach(product => {
            product.price = Number(product.price);
        });
        
        // Calculate statistics
        const totalProducts = results.length;
        const inStock = results.filter(p => p.quantity > 0).length;
        const lowStock = results.filter(p => p.quantity > 0 && p.quantity <= 5).length;
        const outOfStock = results.filter(p => p.quantity === 0).length;
        
        res.render('inventory', { 
            products: results, 
            user: req.session.user,
            categories: {},
            searchTerm: searchTerm,
            stockFilter: stockFilter,
            sortBy: sortBy,
            sortOrder: sortOrder,
            stats: {
                total: totalProducts,
                inStock: inStock,
                lowStock: lowStock,
                outOfStock: outOfStock
            }
        });
    });
});

// Manage Users route - Admin only
app.get('/manageUsers', checkAuthenticated, checkAdmin, (req, res) => {
    // Get search and filter parameters from query string
    const searchTerm = req.query.search || '';
    const roleFilter = req.query.role || 'all';
    const sortBy = req.query.sort || 'username';
    const sortOrder = req.query.order || 'ASC';
    
    // Build the SQL query with filtering
    let sqlQuery = 'SELECT userId, username, email, role, address, contact FROM users WHERE 1=1';
    let queryParams = [];
    
    // Add search filter
    if (searchTerm) {
        sqlQuery += ' AND (username LIKE ? OR email LIKE ? OR contact LIKE ?)';
        queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
    }
    
    // Add role filter
    if (roleFilter !== 'all') {
        sqlQuery += ' AND role = ?';
        queryParams.push(roleFilter);
    }
    
    // Add sorting
    const validSortFields = ['username', 'email', 'role', 'userId'];
    const validSortOrders = ['ASC', 'DESC'];
    
    if (validSortFields.includes(sortBy) && validSortOrders.includes(sortOrder.toUpperCase())) {
        sqlQuery += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
    }
    
    // Execute the query
    connection.query(sqlQuery, queryParams, (error, results) => {
        if (error) {
            console.error('Database error:', error);
            return res.status(500).send('Database error');
        }
        
        res.render('manageUsers', { 
            users: results, 
            user: req.session.user,
            categories: {},
            searchTerm: searchTerm,
            roleFilter: roleFilter,
            sortBy: sortBy,
            sortOrder: sortOrder,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

// Update user role route - Admin only with enhanced validation
app.post('/updateUserRole', checkAuthenticated, checkAdmin, (req, res) => {
    const { userId, newRole } = req.body;
    // Server-side validation
    if (!userId || !newRole) {
        req.flash('error', 'User ID and new role are required');
        return res.redirect('/manageUsers');
    }
    // Validate role (note: your schema shows 'customer' as default, so we'll handle all three)
    if (!['user', 'customer', 'admin'].includes(newRole)) {
        req.flash('error', 'Invalid role specified');
        return res.redirect('/manageUsers');
    }
    // Get current user info from database
    connection.query('SELECT username, role FROM users WHERE userId = ?', [userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Database error occurred');
            return res.redirect('/manageUsers');
        }
        if (results.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/manageUsers');
        }
        const currentUser = results[0];
        // Don't allow admin to demote themselves
        if (userId == req.session.user.userId && newRole !== 'admin') {
            req.flash('error', 'You cannot change your own admin role');
            return res.redirect('/manageUsers');
        }
        // Prevent changing role to the same role
        if (currentUser.role === newRole) {
            req.flash('error', `User "${currentUser.username}" already has the role "${newRole}"`);
            return res.redirect('/manageUsers');
        }
        
        // Additional check: prevent removal of the last admin
        if (currentUser.role === 'admin' && newRole !== 'admin') {
            connection.query('SELECT COUNT(*) as adminCount FROM users WHERE role = "admin"', (countError, countResults) => {
                if (countError) {
                    console.error('Database error:', countError);
                    req.flash('error', 'Database error occurred');
                    return res.redirect('/manageUsers');
                }
                
                if (countResults[0].adminCount <= 1) {
                    req.flash('error', 'Cannot remove admin role from the last administrator');
                    return res.redirect('/manageUsers');
                }
                
                // Proceed with role update
                performRoleUpdate(userId, newRole, currentUser.username, req, res);
            });
        } else {
            // Proceed with role update
            performRoleUpdate(userId, newRole, currentUser.username, req, res);
        }
    });
});

// Delete user route - Admin only with enhanced validation
app.post('/deleteUser', checkAuthenticated, checkAdmin, (req, res) => {
    const userId = req.body.userId; // Extract userId from request body
    
    // Server-side validation
    if (!userId) {
        req.flash('error', 'User ID is required');
        return res.redirect('/manageUsers');
    }
    
    // Don't allow admin to delete themselves
    if (userId == req.session.user.userId) {
        req.flash('error', 'You cannot delete your own account');
        return res.redirect('/manageUsers');
    }
    
    // First, check if user exists and get their info using SQL
    connection.query('SELECT username, role FROM users WHERE userId = ?', [userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Database error occurred');
            return res.redirect('/manageUsers');
        }
        
        if (results.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/manageUsers');
        }
        
        const userToDelete = results[0];
        
        // Additional check: prevent deletion of the last admin using SQL
        if (userToDelete.role === 'admin') {
            connection.query('SELECT COUNT(*) as adminCount FROM users WHERE role = "admin"', (countError, countResults) => {
                if (countError) {
                    console.error('Database error:', countError);
                    req.flash('error', 'Database error occurred');
                    return res.redirect('/manageUsers');
                }
                
                if (countResults[0].adminCount <= 1) {
                    req.flash('error', 'Cannot delete the last administrator account');
                    return res.redirect('/manageUsers');
                }
                
                // Proceed with deletion
                performUserDeletion(userId, userToDelete.username, req, res);
            });
        } else {
            // Proceed with deletion for non-admin users
            performUserDeletion(userId, userToDelete.username, req, res);
        }
    });
});

// Edit user route - Admin only
app.get('/editUser/:userId', checkAuthenticated, checkAdmin, (req, res) => {
    const userId = req.params.userId;
    
    // Fetch user data
    connection.query('SELECT userId, username, email, role, address, contact FROM users WHERE userId = ?', [userId], (error, results) => {
        if (error) {
            console.error('Database error:', error);
            req.flash('error', 'Error loading user data');
            return res.redirect('/manageUsers');
        }
        
        if (results.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/manageUsers');
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
            
            res.render('editUser', {
                editUser: results[0],
                user: req.session.user,
                categories: categories,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
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
    const { username, email, password, address, contact } = req.body;
    // Default role to 'user' for security
    const role = 'user';

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            console.error('Registration error:', err);
            
            // Handle specific SQL errors
            if (err.code === 'ER_DUP_ENTRY') {
                if (err.sqlMessage.includes('email')) {
                    req.flash('error', 'An account with this email already exists.');
                } else if (err.sqlMessage.includes('username')) {
                    req.flash('error', 'This username is already taken.');
                } else {
                    req.flash('error', 'An account with these details already exists.');
                }
            } else {
                req.flash('error', 'Registration failed. Please try again.');
            }
            
            req.flash('formData', req.body);
            return res.redirect('/register');
        }
        
        console.log('User registered successfully:', result.insertId);
        req.flash('success', 'Registration successful! Please log in with your new account.');
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

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            throw err;
        }

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0]; 
            req.flash('success', 'Login successful!');
            if(req.session.user.role == 'user')
                res.redirect('/shopping');
            else
                res.redirect('/inventory');
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

app.get('/shopping', checkAuthenticated, (req, res) => {
    // Get hierarchical categories for navbar
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        
        // Structure categories for navbar
        const categories = {};
        const parents = allCategories.filter(cat => cat.parent_id === null);
        
        parents.forEach(parent => {
            const children = allCategories.filter(cat => cat.parent_id === parent.id);
            categories[parent.name.toLowerCase()] = children;
        });
        
        // Fetch products data
        connection.query('SELECT * FROM products', (error, results) => {
            if (error) throw error;
            
            // Convert price to number for each product
            results.forEach(product => {
                product.price = Number(product.price);
            });
            
            res.render('shopping', { 
                user: req.session.user, 
                products: results,
                categories: categories
            });
        });
    });
});

app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    connection.query('SELECT * FROM products WHERE idProducts = ?', [productId], (error, results) => {
        if (error) throw error;

        if (results.length > 0) {
            const product = results[0];

            // Initialize cart in session if not exists
            if (!req.session.cart) {
                req.session.cart = [];
            }

            // Check if product already in cart
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
            // Convert price to number
            results[0].price = Number(results[0].price);
            
            // Render HTML page with the product data
            res.render('product', { 
                product: results[0], 
                user: req.session.user,
                categories: {}
            });
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

app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), (req, res) => {
    // Extract product data from the request body
    const { name, quantity, price } = req.body;
    let image;
    if (req.file) {
        image = req.file.filename; // Save only the filename
    } else {
        image = null;
    }

    const sql = 'INSERT INTO products (productName, quantity, price, image, category_id) VALUES (?, ?, ?, ?, ?)';
    // Insert the new product into the database
    connection.query(sql, [name, quantity, price, image, 1], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error adding product:", error);
            res.status(500).send('Error adding product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE idProducts = ?';

    // Fetch data from MySQL based on the product ID
    connection.query(sql, [productId], (error, results) => {
        if (error) throw error;

        // Check if any product with the given ID was found
        if (results.length > 0) {
            // Render HTML page with the product data
            res.render('updateProduct', { 
                product: results[0],
                user: req.session.user,
                categories: {}
            });
        } else {
            // If no product with the given ID was found, render a 404 page or handle it accordingly
            res.status(404).send('Product not found');
        }
    });
});

app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), (req, res) => {
    const productId = req.params.id;
    // Extract product data from the request body
    const { name, quantity, price } = req.body;
    let image = req.body.currentImage; //retrieve current image filename
    if (req.file) { //if new image is uploaded
        image = req.file.filename; // set image to be new image filename
    } 

    const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image =? WHERE idProducts = ?';
    // Insert the new product into the database
    connection.query(sql, [name, quantity, price, image, productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error updating product:", error);
            res.status(500).send('Error updating product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const productId = req.params.id;

    connection.query('DELETE FROM products WHERE idProducts = ?', [productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error deleting product:", error);
            res.status(500).send('Error deleting product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

// remove item from cart
app.post('/remove-from-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    
    if (!req.session.cart) {
        req.flash('error', 'Cart is empty');
        return res.redirect('/cart');
    }

    // Filter out the item to remove
    req.session.cart = req.session.cart.filter(item => item.idProducts !== productId);
    
    req.flash('success', 'Item removed from cart');
    res.redirect('/cart');
});

// Clear entire cart
app.post('/clear-cart', checkAuthenticated, (req, res) => {
    req.session.cart = [];
    req.flash('success', 'Cart cleared successfully');
    res.redirect('/cart');
});

// Checkout routes
app.get('/checkout', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    
    // Redirect to cart if empty
    if (cart.length === 0) {
        req.flash('error', 'Your cart is empty. Add some items before checkout.');
        return res.redirect('/cart');
    }
    
    // Calculate total
    let total = 0;
    cart.forEach(item => {
        total += Number(item.price) * item.quantity;
    });
    
    // Get hierarchical categories for navbar
    connection.query('SELECT * FROM categories', (error, allCategories) => {
        if (error) throw error;
        
        // Structure categories for navbar
        const categories = {};
        const parents = allCategories.filter(cat => cat.parent_id === null);
        
        parents.forEach(parent => {
            const children = allCategories.filter(cat => cat.parent_id === parent.id);
            categories[parent.name.toLowerCase()] = children;
        });
        
        res.render('checkout', {
            cart,
            total: total.toFixed(2),
            user: req.session.user,
            categories,
            messages: req.flash()
        });
    });
});

app.post('/checkout', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    const { paymentMethod, cardNumber, expiry, cvv, deliveryAddress, deliveryNotes } = req.body;
    
    // Validate cart is not empty
    if (cart.length === 0) {
        req.flash('error', 'Your cart is empty');
        return res.redirect('/cart');
    }
    
    // Validate payment method
    if (!paymentMethod) {
        req.flash('error', 'Please select a payment method');
        return res.redirect('/checkout');
    }
    
    // Validate credit card fields if Credit/Debit Card is selected
    if (paymentMethod === 'Credit/Debit Card') {
        if (!cardNumber || !expiry || !cvv) {
            req.flash('error', 'Please fill in all credit card details');
            return res.redirect('/checkout');
        }
    }
    
    // Validate delivery address
    if (!deliveryAddress || deliveryAddress.trim().length === 0) {
        req.flash('error', 'Delivery address is required');
        return res.redirect('/checkout');
    }
    
    // Calculate total
    let subtotal = 0;
    cart.forEach(item => {
        subtotal += Number(item.price) * item.quantity;
    });
    
    // Generate order number
    const orderNumber = 'HG' + Date.now();
    
    // Create order in database (matching your schema)
    const orderSql = `INSERT INTO orders (userId, order_number, status, subtotal, discount_amount, total_amount, shipping_address, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
    const orderValues = [
        req.session.user.userId, 
        orderNumber,
        'pending', 
        subtotal, 
        0.00, // no discount for now
        subtotal, 
        deliveryAddress
    ];
    
    connection.query(orderSql, orderValues, (error, orderResult) => {
        if (error) {
            console.error('Error creating order:', error);
            req.flash('error', 'Error processing your order. Please try again.');
            return res.redirect('/checkout');
        }
        
        const orderId = orderResult.insertId;
        
    
        const itemPromises = cart.map(item => {
            return new Promise((resolve, reject) => {
                // First, check if product has variants
                const checkVariantSql = 'SELECT id FROM product_variants WHERE idProducts = ? LIMIT 1';
                connection.query(checkVariantSql, [item.idProducts], (error, variantResults) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    
                    let variantId = null;
                    if (variantResults.length > 0) {
                        // Use the first variant if available
                        variantId = variantResults[0].id;
                    }
                    
                    // Insert order item (using your schema structure)
                    const itemSql = 'INSERT INTO order_items (order_id, product_variant_id, quantity, unit_price) VALUES (?, ?, ?, ?)';
                    connection.query(itemSql, [orderId, variantId, item.quantity, item.price], (error) => {
                        if (error) {
                            reject(error);
                        } else {
                            // Update product quantity (main products table)
                            const updateSql = 'UPDATE products SET quantity = quantity - ? WHERE idProducts = ?';
                            connection.query(updateSql, [item.quantity, item.idProducts], (updateError) => {
                                if (updateError) {
                                    console.error('Error updating product quantity:', updateError);
                                }
                                resolve();
                            });
                        }
                    });
                });
            });
        });
        
        Promise.all(itemPromises)
            .then(() => {
                // Clear cart
                req.session.cart = [];
                
                // Redirect to receipt page
                req.flash('success', 'Order placed successfully!');
                res.redirect(`/receipt/${orderId}`);
            })
            .catch((error) => {
                console.error('Error processing order items:', error);
                req.flash('error', 'Error processing your order. Please contact support.');
                res.redirect('/checkout');
            });
    });
});

// Receipt route
app.get('/receipt/:orderId', checkAuthenticated, (req, res) => {
    const orderId = req.params.orderId;
    
    // Get order details (matching your schema)
    const orderSql = `
        SELECT o.*, u.username, u.email 
        FROM orders o 
        JOIN users u ON o.userId = u.userId 
        WHERE o.id = ? AND o.userId = ?
    `;
    
    connection.query(orderSql, [orderId, req.session.user.userId], (error, orderResults) => {
        if (error) {
            console.error('Error fetching order:', error);
            req.flash('error', 'Order not found');
            return res.redirect('/shopping');
        }
        
        if (orderResults.length === 0) {
            req.flash('error', 'Order not found or access denied');
            return res.redirect('/shopping');
        }
        
        // Get order items (matching your schema with product_variants)
        const itemsSql = `
            SELECT oi.*, p.productName, p.image, pv.size, pv.color
            FROM order_items oi 
            JOIN product_variants pv ON oi.product_variant_id = pv.id
            JOIN products p ON pv.idProducts = p.idProducts 
            WHERE oi.order_id = ?
        `;
        
        connection.query(itemsSql, [orderId], (error, itemResults) => {
            if (error) {
                console.error('Error fetching order items:', error);
                
                // Fallback query for orders without variants
                const fallbackSql = `
                    SELECT oi.*, p.productName, p.image
                    FROM order_items oi 
                    LEFT JOIN product_variants pv ON oi.product_variant_id = pv.id
                    LEFT JOIN products p ON (pv.idProducts = p.idProducts OR oi.product_variant_id IS NULL)
                    WHERE oi.order_id = ?
                `;
                
                connection.query(fallbackSql, [orderId], (fallbackError, fallbackResults) => {
                    if (fallbackError) {
                        console.error('Error in fallback query:', fallbackError);
                        req.flash('error', 'Error loading order details');
                        return res.redirect('/shopping');
                    }
                    
                    renderReceipt(orderResults[0], fallbackResults, req, res);
                });
            } else {
                renderReceipt(orderResults[0], itemResults, req, res);
            }
        });
    });
});

// Add user route - Admin only (SQL-focused validation)
app.post('/addUser', checkAuthenticated, checkAdmin, (req, res) => {
    const { username, email, password, confirmPassword, address, contact, role } = req.body;
    
    // Basic server-side validation (minimal)
    if (!username || !email || !password || !confirmPassword || !address || !contact || !role) {
        req.flash('error', 'All fields are required');
        return res.redirect('/manageUsers');
    }
    
    // Password confirmation check
    if (password !== confirmPassword) {
        req.flash('error', 'Passwords do not match');
        return res.redirect('/manageUsers');
    }
    
    // Use SQL to validate and create user in a single transaction
    connection.beginTransaction((transactionError) => {
        if (transactionError) {
            console.error('Transaction start error:', transactionError);
            req.flash('error', 'Database transaction failed');
            return res.redirect('/manageUsers');
        }
        
        // SQL validation query - check for existing username and email in one query
        const checkExistingSQL = `
            SELECT 
                COUNT(CASE WHEN username = ? THEN 1 END) as usernameExists,
                COUNT(CASE WHEN email = ? THEN 1 END) as emailExists,
                (SELECT COUNT(*) FROM users WHERE role = 'admin') as adminCount
            FROM users
        `;
        
        connection.query(checkExistingSQL, [username, email], (checkError, checkResults) => {
            if (checkError) {
                return connection.rollback(() => {
                    console.error('SQL validation error:', checkError);
                    req.flash('error', 'Database validation failed');
                    res.redirect('/manageUsers');
                });
            }
            
            const { usernameExists, emailExists, adminCount } = checkResults[0];
            
            // SQL-based validation results
            if (usernameExists > 0) {
                return connection.rollback(() => {
                    req.flash('error', 'Username is already taken');
                    res.redirect('/manageUsers');
                });
            }
            
            if (emailExists > 0) {
                return connection.rollback(() => {
                    req.flash('error', 'Email is already registered');
                    res.redirect('/manageUsers');
                });
            }
            
            // SQL constraint validation for password length
            if (password.length < 6) {
                return connection.rollback(() => {
                    req.flash('error', 'Password must be at least 6 characters long');
                    res.redirect('/manageUsers');
                });
            }
            
            // SQL constraint validation for username length
            if (username.length < 3 || username.length > 20) {
                return connection.rollback(() => {
                    req.flash('error', 'Username must be between 3 and 20 characters');
                    res.redirect('/manageUsers');
                });
            }
            
            // SQL constraint validation for contact length
            if (contact.length < 8 || contact.length > 15) {
                return connection.rollback(() => {
                    req.flash('error', 'Contact number must be between 8 and 15 characters');
                    res.redirect('/manageUsers');
                });
            }
            
            // SQL constraint validation for role
            const validRoles = ['user', 'customer', 'admin'];
            if (!validRoles.includes(role)) {
                return connection.rollback(() => {
                    req.flash('error', 'Invalid role specified');
                    res.redirect('/manageUsers');
                });
            }
            
            // Hash password using SQL SHA1 function
            const insertUserSQL = `
                INSERT INTO users (username, email, password, address, contact, role) 
                VALUES (?, ?, SHA1(?), ?, ?, ?)
            `;
            
            connection.query(insertUserSQL, [username, email, password, address, contact, role], (insertError, insertResults) => {
                if (insertError) {
                    return connection.rollback(() => {
                        console.error('SQL insert error:', insertError);
                        
                        // Handle specific SQL constraints
                        if (insertError.code === 'ER_DUP_ENTRY') {
                            if (insertError.message.includes('email')) {
                                req.flash('error', 'Email address is already registered');
                            } else {
                                req.flash('error', 'Username is already taken');
                            }
                        } else if (insertError.code === 'ER_DATA_TOO_LONG') {
                            req.flash('error', 'One or more fields exceed maximum length');
                        } else if (insertError.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
                            req.flash('error', 'Data validation failed - check field requirements');
                        } else {
                            req.flash('error', 'Failed to create user account');
                        }
                        res.redirect('/manageUsers');
                    });
                }
                
                // Commit the transaction
                connection.commit((commitError) => {
                    if (commitError) {
                        return connection.rollback(() => {
                            console.error('SQL commit error:', commitError);
                            req.flash('error', 'Failed to save user data');
                            res.redirect('/manageUsers');
                        });
                    }
                    
                    // Success - use SQL to get the created user info
                    const getUserInfoSQL = `
                        SELECT username, email, role, userId 
                        FROM users 
                        WHERE userId = ?
                    `;
                    
                    connection.query(getUserInfoSQL, [insertResults.insertId], (getUserError, userResults) => {
                        if (getUserError) {
                            console.error('Error fetching new user info:', getUserError);
                            req.flash('success', `User "${username}" created successfully`);
                        } else {
                            const newUser = userResults[0];
                            req.flash('success', `User "${newUser.username}" (ID: ${newUser.userId}) created successfully with ${newUser.role} privileges`);
                        }
                        res.redirect('/manageUsers');
                    });
                });
            });
        });
    });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port http://localhost:${PORT}`));