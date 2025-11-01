const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    telegramId: {
        type: Number,
        required: true,
        unique: true,
        index: true
    },

    // Profile information
    profile: {
        firstName: {
            type: String,
            required: true,
            trim: true
        },
        lastName: {
            type: String,
            required: false,
            trim: true
        },
        birthYear: {
            type: Number,
            min: 1900,
            max: new Date().getFullYear()
        },
        phoneNumber: {
            type: String,
            trim: true
        },
        role: {
            type: String,
            enum: ['driver', 'client'],
            required: false
        }
    },

    // Driver-specific information
    driverInfo: {
        vehicleModel: {
            type: String,
            trim: true
        },
        vehicleCategory: {
            type: String,
            enum: ['light', 'medium', 'heavy', 'special'],
            trim: true
        },
        preferredRoutes: [{
            from: String,
            to: String
        }],
        currentLocation: {
            type: String,
            trim: true
        }
    },

    // Reputation system
    reputation: {
        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        completedDeals: {
            type: Number,
            default: 0
        },
        totalReviews: {
            type: Number,
            default: 0
        }
    },

    // Order management
    activeOrders: {
        type: Number,
        default: 0
    },
    maxOrders: {
        type: Number,
        default: 1 // Start with 1 for new users
    },

    // User settings
    language: {
        type: String,
        enum: ['ru', 'uz', 'en'],
        default: 'ru'
    },

    // Registration status
    registrationCompleted: {
        type: Boolean,
        default: false
    },
    registrationStep: {
        type: String,
        enum: ['start', 'role', 'personal_info', 'vehicle_info', 'contact', 'completed'],
        default: 'start'
    },

    // Timestamps
    lastActivity: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
userSchema.index({ 'profile.role': 1 });
userSchema.index({ 'driverInfo.currentLocation': 1 });
userSchema.index({ registrationCompleted: 1 });
userSchema.index({ lastActivity: 1 });

// Virtual for full name
userSchema.virtual('profile.fullName').get(function () {
    return `${this.profile.firstName} ${this.profile.lastName}`.trim();
});

// Methods
userSchema.methods.isDriver = function () {
    return this.profile.role === 'driver';
};

userSchema.methods.isClient = function () {
    return this.profile.role === 'client';
};

userSchema.methods.canTakeMoreOrders = function () {
    return this.activeOrders < this.maxOrders;
};

userSchema.methods.updateLastActivity = function () {
    this.lastActivity = new Date();
    return this.save();
};

// Static methods
userSchema.statics.findByTelegramId = function (telegramId) {
    return this.findOne({ telegramId });
};

userSchema.statics.getDriversByLocation = function (location) {
    return this.find({
        'profile.role': 'driver',
        'driverInfo.currentLocation': new RegExp(location, 'i'),
        registrationCompleted: true
    });
};

module.exports = mongoose.model('User', userSchema);