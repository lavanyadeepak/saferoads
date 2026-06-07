const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Multer config for image uploads (temporary storage)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Helper: Get traffic handle for city
function getTrafficHandle(city) {
    const envKey = `${city.toUpperCase().replace(/\s/g, '_')}_TRAFFIC_POLICE`;
    const handle = process.env[envKey];
    return handle || process.env.DEFAULT_TRAFFIC_HANDLE || '@trafficpolice';
}

// Helper: Create tweet text
function createTweetText(data) {
    const handle = getTrafficHandle(data.city);
    const dateTime = data.datetime || new Date().toLocaleString();

    // Handle multiple categories
    const categories = Array.isArray(data.categories) ? data.categories : [];

    let tweet = `${handle}\n\n`;
    tweet += `📋 Violation: ${categories.join(', ')}\n`;
    tweet += `📍 City: ${data.city}\n`;
    tweet += `📅 Date/Time: ${dateTime}\n`;
    
    if (data.location) {
        tweet += `🗺️ Location: ${data.location}\n`;
    }
    
    tweet += `\n#SafeRoads #RoadSafety #${data.city.replace(/\s/g, '')}`;
    
    // Add violation-specific hashtags
    categories.forEach(cat => {
        const violationTag = String(cat).replace(/\s/g, '').substring(0, 30);
        tweet += ` #${violationTag}`;
    });
    
    // Truncate if exceeds 280 chars
    if (tweet.length > 280) {
        tweet = tweet.substring(0, 277) + '...';
    }
    
    return tweet;
}

// Prepare tweet preview (doesn't post)
app.post('/api/prepare-tweet', upload.single('image'), async (req, res) => {
    try {
        const { category, city, datetime, location } = req.body;
        const imageFile = req.file;
        
        // Validate required fields
        // Ensure categories is always an array of strings
        const categories = [].concat(category || []).filter(c => typeof c === 'string' && c.length > 0);
        
        if (categories.length === 0 || !city) {
            return res.status(400).json({ error: 'At least one Category and City are required' });
        }
        
        const tweetText = createTweetText({ categories, city, datetime, location });
        
        let imageUrl = null;
        if (imageFile) {
            imageUrl = `/uploads/${imageFile.filename}`;
        }
        
        // Get traffic handle for display
        const trafficHandle = getTrafficHandle(city);
        
        res.json({
            success: true,
            tweet: {
                text: tweetText,
                characterCount: tweetText.length,
                imageUrl: imageUrl,
                trafficHandle: trafficHandle,
                city: city,
                category: categories,
                datetime: datetime || new Date().toISOString(),
                location: location || null
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to prepare tweet: ' + error.message });
    }
});

// Get list of cities (from .env)
app.get('/api/cities', (req, res) => {
    const cities = Object.keys(process.env)
        .filter(key => key.endsWith('_TRAFFIC_POLICE'))
        .map(key => key.replace('_TRAFFIC_POLICE', ''))
        .map(city => city.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' '));
    
    // Add default cities if none in .env
    if (cities.length === 0) {
        cities.push('Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad');
    }
    
    res.json({ cities });
});

// Get categories
app.get('/api/categories', (req, res) => {
    const categories = [
        "Defective Number Plate",
        "One Way / No Entry",
        "No Parking / Wrong Parking",
        "Not Wearing Seat Belt",
        "Parking on Footpath / Footpath Driving/Riding",
        "Biker without Helmet",
        "Pillion Riding without Helmet",
        "Toddler without helmet or safety harness",
        "Parking near Traffic Light / Stopped on Pedestrian Crossing",
        "Taking a Prohibited U-Turn",
        "Triple Riding",
        "Using Mobile While Driving",
        "Violating Lane Discipline",
        "Using Black Film / Other Prohibited Materials",
        "Red Light Jump",
        "J Walking",
        "Over Speeding",
        "DUI / Drunk Driving",
        "Not wearing seat belt",
        "Riding without a valid license",
        "Driving without insurance",
        "Illegal Overtaking",
        "PUC Emission Violation",
        "Driving without headlights at night",
        "Riding without a rearview mirror",
        "Noisy Engine / Honking in No Honking Zone",
        "Riding without a proper muffler",
        "Driving in Bus Lane",
    ];
    res.json({ categories });
});

// Cleanup old images endpoint (optional)
app.delete('/api/cleanup', (req, res) => {
    const fs = require('fs');
    const uploadDir = 'uploads/';
    
    fs.readdir(uploadDir, (err, files) => {
        if (err) return res.json({ error: err.message });
        
        const now = Date.now();
        let deleted = 0;
        
        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                // Delete files older than 1 hour
                if (now - stats.mtimeMs > 3600000) {
                    fs.unlink(filePath, () => deleted++);
                }
            });
        });
        
        res.json({ message: `Cleanup initiated for old images` });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Tweet preview mode - no auto-posting to Twitter`);
});