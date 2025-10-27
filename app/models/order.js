const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    // References
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },

    // Cargo information
    cargo: {
        from: {
            type: String,
            required: true,
            trim: true
        },
        to: {
            type: String,
            trim: true
        },
        scheduledDate: {
            type: Date
        },
        description: {
            type: String,
            trim: true,
            maxlength: 1000
        },
        price: {
            type: Number,
            min: 0
        },
        weight: {
            type: String,
            trim: true
        },
        dimensions: {
            type: String,
            trim: true
        }
    },

    // Contact information
    contactInfo: {
        phoneNumber: {
            type: String,
            trim: true
        },
        contactName: {
            type: String,
            trim: true
        }
    },

    // Order status
    status: {
        type: String,
        enum: ['active', 'matched', 'in_progress', 'completed', 'cancelled'],
        default: 'active',
        index: true
    },

    // Group posting
    publishedToGroup: {
        type: Boolean,
        default: false
    },
    groupMessageId: {
        type: Number
    },

    // Matching and responses
    interestedDrivers: [{
        driverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        respondedAt: {
            type: Date,
            default: Date.now
        }
    }],

    // Deal completion
    dealCompletedBy: {
        client: { type: Boolean, default: false },
        driver: { type: Boolean, default: false }
    },

    // Reviews
    reviews: {
        clientReview: {
            rating: { type: Number, min: 1, max: 5 },
            comment: { type: String, maxlength: 500 },
            createdAt: Date
        },
        driverReview: {
            rating: { type: Number, min: 1, max: 5 },
            comment: { type: String, maxlength: 500 },
            createdAt: Date
        }
    },

    // Timestamps for specific actions
    matchedAt: Date,
    startedAt: Date,
    completedAt: Date,

    // Auto-reminders
    remindersSent: {
        type: Number,
        default: 0
    },
    lastReminderAt: Date
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'cargo.from': 1 });
orderSchema.index({ 'cargo.scheduledDate': 1 });
orderSchema.index({ publishedToGroup: 1 });

// Virtual for order summary
orderSchema.virtual('summary').get(function () {
    const fromTo = this.cargo.to ? `${this.cargo.from} → ${this.cargo.to}` : this.cargo.from;
    const price = this.cargo.price ? ` (${this.cargo.price} сум)` : '';
    return `${fromTo}${price}`;
});

// Methods
orderSchema.methods.isActive = function () {
    return this.status === 'active';
};

orderSchema.methods.isCompleted = function () {
    return this.status === 'completed';
};

orderSchema.methods.canBeMatched = function () {
    return this.status === 'active' && !this.driverId;
};

orderSchema.methods.assignDriver = function (driverId) {
    this.driverId = driverId;
    this.status = 'matched';
    this.matchedAt = new Date();
    return this.save();
};

orderSchema.methods.startProgress = function () {
    this.status = 'in_progress';
    this.startedAt = new Date();
    return this.save();
};

orderSchema.methods.markCompleted = function () {
    this.status = 'completed';
    this.completedAt = new Date();
    return this.save();
};

orderSchema.methods.addInterestedDriver = function (driverId) {
    const exists = this.interestedDrivers.some(
        driver => driver.driverId.toString() === driverId.toString()
    );

    if (!exists) {
        this.interestedDrivers.push({ driverId });
        return this.save();
    }
    return Promise.resolve(this);
};

// Static methods
orderSchema.statics.findActiveOrders = function () {
    return this.find({ status: 'active' })
        .populate('clientId', 'profile contactInfo')
        .sort({ createdAt: -1 });
};

orderSchema.statics.findOrdersByLocation = function (location) {
    return this.find({
        status: 'active',
        'cargo.from': new RegExp(location, 'i')
    }).populate('clientId', 'profile');
};

orderSchema.statics.findUserOrders = function (userId, status = null) {
    const query = {
        $or: [
            { clientId: userId },
            { driverId: userId }
        ]
    };

    if (status) {
        query.status = status;
    }

    return this.find(query)
        .populate('clientId', 'profile')
        .populate('driverId', 'profile')
        .sort({ createdAt: -1 });
};

module.exports = mongoose.model('Order', orderSchema);