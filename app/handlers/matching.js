const User = require('../models/user');
const Order = require('../models/order');
const { t } = require('../utils/i18nHelper');
const { logAction } = require('../logger');
const { calculateDistance } = require('./common');

/**
 * Find suitable drivers for an order using simple location-based matching
 */
const findSuitableDrivers = async (order, limit = 10) => {
    try {
        const orderLocation = order.cargo.from.toLowerCase().trim();

        // Get all active drivers
        const drivers = await User.find({
            'profile.role': 'driver',
            registrationCompleted: true,
            activeOrders: { $lt: '$maxOrders' } // Can take more orders
        }).lean();

        if (drivers.length === 0) {
            return [];
        }

        // Calculate match scores for each driver
        const driverScores = drivers.map(driver => {
            const score = calculateDriverScore(driver, order, orderLocation);
            return {
                driver,
                score,
                distance: calculateDistance(orderLocation, driver.driverInfo?.currentLocation || '')
            };
        });

        // Sort by score (higher is better)
        driverScores.sort((a, b) => b.score - a.score);

        // Return top matches
        return driverScores.slice(0, limit);

    } catch (error) {
        console.error('Error in findSuitableDrivers:', error);
        return [];
    }
};

/**
 * Calculate driver match score for an order
 */
const calculateDriverScore = (driver, order, orderLocation) => {
    let score = 0;

    // Base score
    score += 10;

    // Location matching (most important factor)
    const driverLocation = (driver.driverInfo?.currentLocation || '').toLowerCase().trim();
    if (driverLocation) {
        if (driverLocation === orderLocation) {
            score += 50; // Exact location match
        } else if (driverLocation.includes(orderLocation) || orderLocation.includes(driverLocation)) {
            score += 30; // Partial location match
        } else {
            // Calculate distance penalty
            const distance = calculateDistance(orderLocation, driverLocation);
            if (distance <= 50) {
                score += 20; // Very close
            } else if (distance <= 150) {
                score += 10; // Reasonably close
            } else if (distance <= 300) {
                score += 5; // Somewhat far
            }
            // No points for very far locations
        }
    }

    // Reputation score
    const rating = driver.reputation?.rating || 0;
    const completedDeals = driver.reputation?.completedDeals || 0;

    score += rating * 5; // Rating contributes up to 25 points
    score += Math.min(completedDeals * 2, 20); // Experience contributes up to 20 points

    // Availability bonus
    const activeOrders = driver.activeOrders || 0;
    const maxOrders = driver.maxOrders || 1;
    const availabilityRatio = (maxOrders - activeOrders) / maxOrders;
    score += availabilityRatio * 10;

    // Vehicle category matching (basic implementation)
    if (order.cargo.weight) {
        const weight = order.cargo.weight.toLowerCase();
        const vehicleCategory = driver.driverInfo?.vehicleCategory || '';

        if (weight.includes('тяжел') || weight.includes('тонн')) {
            if (vehicleCategory === 'heavy') score += 15;
            else if (vehicleCategory === 'medium') score += 10;
            else if (vehicleCategory === 'light') score -= 10;
        } else if (weight.includes('средн')) {
            if (vehicleCategory === 'medium') score += 15;
            else if (vehicleCategory === 'heavy') score += 10;
            else if (vehicleCategory === 'light') score += 5;
        } else {
            if (vehicleCategory === 'light') score += 15;
            else if (vehicleCategory === 'medium') score += 10;
        }
    }

    // Recent activity bonus
    const lastActivity = new Date(driver.lastActivity);
    const daysSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceActivity <= 1) {
        score += 15; // Very recent activity
    } else if (daysSinceActivity <= 7) {
        score += 10; // Recent activity
    } else if (daysSinceActivity <= 30) {
        score += 5; // Somewhat recent
    }
    // No bonus for inactive users

    return Math.max(0, score);
};

/**
 * Get matching drivers for a specific order with formatted display
 */
const getMatchingDriversForOrder = async (order, ctx) => {
    try {
        const matches = await findSuitableDrivers(order, 5);

        if (matches.length === 0) {
            return {
                found: false,
                message: t(ctx, 'matching.no_drivers'),
                drivers: []
            };
        }

        let driversText = '';
        const drivers = [];

        matches.forEach((match, index) => {
            const driver = match.driver;
            const driverInfo = {
                id: driver._id,
                name: `${driver.profile.firstName} ${driver.profile.lastName}`.trim(),
                rating: driver.reputation?.rating || 0,
                completedDeals: driver.reputation?.completedDeals || 0,
                vehicle: driver.driverInfo?.vehicleModel || 'Не указано',
                vehicleCategory: driver.driverInfo?.vehicleCategory || '',
                location: driver.driverInfo?.currentLocation || 'Не указано',
                phone: driver.profile?.phoneNumber || 'Не указан',
                score: match.score,
                distance: match.distance
            };

            drivers.push(driverInfo);

            driversText += t(ctx, 'matching.driver_info', {
                name: driverInfo.name,
                rating: driverInfo.rating.toFixed(1),
                vehicle: driverInfo.vehicle,
                location: driverInfo.location
            });
        });

        return {
            found: true,
            message: t(ctx, 'matching.found_drivers', { drivers: driversText }),
            drivers: drivers
        };

    } catch (error) {
        console.error('Error getting matching drivers:', error);
        return {
            found: false,
            message: t(ctx, 'errors.general'),
            drivers: []
        };
    }
};

/**
 * Notify drivers about new orders in their area
 */
const notifyRelevantDrivers = async (order, ctx) => {
    try {
        const matches = await findSuitableDrivers(order, 10);

        if (matches.length === 0) {
            logAction('no_drivers_to_notify', {
                orderId: order._id,
                orderLocation: order.cargo.from
            });
            return;
        }

        const notificationText = t(ctx, 'notifications.new_order_available', {
            orderSummary: order.summary
        });

        const keyboard = {
            inline_keyboard: [
                [
                    {
                        text: '👀 Посмотреть заказ',
                        callback_data: `order:view:${order._id}`
                    },
                    {
                        text: '✋ Откликнуться',
                        callback_data: `order:interest:${order._id}`
                    }
                ]
            ]
        };

        let notifiedCount = 0;

        // Notify top matching drivers
        for (const match of matches.slice(0, 5)) { // Top 5 drivers
            try {
                await ctx.telegram.sendMessage(
                    match.driver.telegramId,
                    notificationText,
                    { reply_markup: keyboard }
                );
                notifiedCount++;

                logAction('driver_notified', {
                    orderId: order._id,
                    driverId: match.driver._id,
                    matchScore: match.score,
                    distance: match.distance
                });

                // Small delay to avoid hitting rate limits
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.warn(`Failed to notify driver ${match.driver._id}:`, error.message);
            }
        }

        logAction('drivers_notification_completed', {
            orderId: order._id,
            totalMatches: matches.length,
            notifiedCount: notifiedCount
        });

    } catch (error) {
        logAction('notification_error', {
            orderId: order._id,
            error: error.message
        });
        console.error('Error notifying drivers:', error);
    }
};

/**
 * Find orders for a specific driver
 */
const findOrdersForDriver = async (driver, limit = 10) => {
    try {
        const driverLocation = driver.driverInfo?.currentLocation?.toLowerCase().trim() || '';

        // Get active orders
        const orders = await Order.find({
            status: 'active',
            driverId: null // Not yet assigned
        })
            .populate('clientId', 'profile')
            .lean();

        if (orders.length === 0) {
            return [];
        }

        // Calculate match scores for each order
        const orderScores = orders.map(order => {
            const score = calculateOrderScore(order, driver, driverLocation);
            return {
                order,
                score,
                distance: calculateDistance(driverLocation, order.cargo.from.toLowerCase().trim())
            };
        });

        // Sort by score (higher is better)
        orderScores.sort((a, b) => b.score - a.score);

        return orderScores.slice(0, limit);

    } catch (error) {
        console.error('Error finding orders for driver:', error);
        return [];
    }
};

/**
 * Calculate order match score for a driver
 */
const calculateOrderScore = (order, driver, driverLocation) => {
    let score = 0;

    // Base score
    score += 10;

    // Location matching
    const orderLocation = order.cargo.from.toLowerCase().trim();
    if (driverLocation) {
        if (driverLocation === orderLocation) {
            score += 50; // Exact location match
        } else if (driverLocation.includes(orderLocation) || orderLocation.includes(driverLocation)) {
            score += 30; // Partial location match
        } else {
            const distance = calculateDistance(driverLocation, orderLocation);
            if (distance <= 50) {
                score += 20;
            } else if (distance <= 150) {
                score += 10;
            } else if (distance <= 300) {
                score += 5;
            }
        }
    }

    // Price attractiveness
    if (order.cargo.price) {
        if (order.cargo.price >= 500000) { // 500k+ sum
            score += 20;
        } else if (order.cargo.price >= 200000) { // 200k+ sum
            score += 15;
        } else if (order.cargo.price >= 100000) { // 100k+ sum
            score += 10;
        } else if (order.cargo.price >= 50000) { // 50k+ sum
            score += 5;
        }
    }

    // Urgency bonus for scheduled orders
    if (order.cargo.scheduledDate) {
        const daysUntil = (new Date(order.cargo.scheduledDate) - new Date()) / (1000 * 60 * 60 * 24);
        if (daysUntil <= 1) {
            score += 15; // Very urgent
        } else if (daysUntil <= 3) {
            score += 10; // Somewhat urgent
        } else if (daysUntil <= 7) {
            score += 5; // Planning ahead
        }
    }

    // Order age penalty (older orders are less attractive)
    const orderAge = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60);
    if (orderAge <= 2) {
        score += 10; // Very fresh
    } else if (orderAge <= 24) {
        score += 5; // Fresh
    } else if (orderAge <= 72) {
        score += 0; // Neutral
    } else {
        score -= 5; // Getting stale
    }

    return Math.max(0, score);
};

/**
 * Update driver experience level and max orders
 */
const updateDriverExperience = async (driverId) => {
    try {
        const driver = await User.findById(driverId);
        if (!driver || !driver.isDriver()) return;

        const completedDeals = driver.reputation.completedDeals;

        // Increase max orders based on experience
        if (completedDeals >= 10 && driver.maxOrders < 3) {
            driver.maxOrders = 3;
        } else if (completedDeals >= 25 && driver.maxOrders < 5) {
            driver.maxOrders = 5;
        }

        await driver.save();

        logAction('driver_experience_updated', {
            driverId: driver._id,
            completedDeals: completedDeals,
            newMaxOrders: driver.maxOrders
        });

    } catch (error) {
        console.error('Error updating driver experience:', error);
    }
};

module.exports = {
    findSuitableDrivers,
    getMatchingDriversForOrder,
    notifyRelevantDrivers,
    findOrdersForDriver,
    updateDriverExperience,
    calculateDriverScore,
    calculateOrderScore
};