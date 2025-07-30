const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
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

// Set up view engine
app.set('view engine', 'ejs');
// enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

// Session Middleware
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
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact, role } = req.body;
    if (!username || !email || !password || !address || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }
    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// ROUTES
app.get('/', (req, res) => {
  const sql = 'SELECT * FROM products';
  connection.query(sql, (error, results) => {
    if (error) {
      console.error('Database query error:', error.message);
      return res.status(500).send('Error retrieving products');
    }
    res.render('shopping', { 
        products: results,
        user: req.session.user || null
    });
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
    connection.query('SELECT * FROM products', (error, results) => {
        if (error) {
            console.error('Database error:', error);
            return res.status(500).send('Database error');
        }
        res.render('inventory', { 
            products: results || [],
            user: req.session.user || req.session || {}
        });
    });
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact, role } = req.body;
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) throw err;
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
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
    res.render('cart', { cart, user: req.session.user });
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

app.get('/product/:id', checkAuthenticated, (req, res) => {
  const productId = req.params.id;
  connection.query('SELECT * FROM products WHERE idProducts = ?', [productId], (error, results) => {
      if (error) throw error;
      if (results.length > 0) {
          res.render('product', { product: results[0], user: req.session.user  });
      } else {
          res.status(404).send('Product not found');
      }
  });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', {user: req.session.user } ); 
});

app.post('/addProduct', upload.single('image'),  (req, res) => {
    const { name, quantity, price} = req.body;
    let image;
    if (req.file) {
        image = req.file.filename;
    } else {
        image = null;
    }
    const sql = 'INSERT INTO products (productName, quantity, price, image, category_id) VALUES (?, ?, ?, ?, ?)';
    connection.query(sql , [name, quantity, price, image, 1], (error, results) => {
        if (error) {
            console.error("Error adding product:", error);
            res.status(500).send('Error adding product');
        } else {
            res.redirect('/inventory');
        }
    });
});

app.get('/updateProduct/:id',checkAuthenticated, checkAdmin, (req,res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE idProducts = ?';
    connection.query(sql , [productId], (error, results) => {
        if (error) throw error;
        if (results.length > 0) {
            res.render('updateProduct', { product: results[0] });
        } else {
            res.status(404).send('Product not found');
        }
    });
});

app.post('/updateProduct/:id', upload.single('image'), (req, res) => {
    const productId = req.params.id;
    const { name, quantity, price } = req.body;
    let image  = req.body.currentImage;
    if (req.file) {
        image = req.file.filename;
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

app.get('/deleteProduct/:id', (req, res) => {
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

