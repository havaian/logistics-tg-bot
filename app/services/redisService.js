const redis = require('redis');

class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    /**
     * Initialize Redis connection
     */
    async connect() {
        try {
            const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

            this.client = redis.createClient({
                url: redisUrl,
                password: process.env.REDIS_PASSWORD || undefined,
                database: parseInt(process.env.REDIS_DB) || 0,
                retry_strategy: (options) => {
                    if (options.error && options.error.code === 'ECONNREFUSED') {
                        global.logger.logError('Redis connection refused');
                        return new Error('Redis connection refused');
                    }
                    if (options.total_retry_time > 1000 * 60 * 60) {
                        global.logger.logError('Redis retry time exhausted');
                        return new Error('Retry time exhausted');
                    }
                    if (options.attempt > 10) {
                        global.logger.logError('Redis max retry attempts reached');
                        return undefined;
                    }
                    // Exponential backoff: 50ms * 2^attempt, max 3000ms
                    return Math.min(options.attempt * 50, 3000);
                }
            });

            this.client.on('error', (err) => {
                global.logger.logError('Redis error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                global.logger.logInfo('Redis connected');
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                global.logger.logInfo('Redis ready');
                this.isConnected = true;
            });

            this.client.on('end', () => {
                global.logger.logInfo('Redis connection ended');
                this.isConnected = false;
            });

            await this.client.connect();

            // Test connection
            await this.client.ping();

            return true;
        } catch (error) {
            global.logger.logError('Failed to connect to Redis:', error);
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Disconnect from Redis
     */
    async disconnect() {
        try {
            if (this.client && this.isConnected) {
                await this.client.quit();
                global.logger.logInfo('Redis connection closed');
            }
        } catch (error) {
            global.logger.logError('Error disconnecting from Redis:', error);
        }
    }

    /**
     * Check if Redis is connected
     */
    isReady() {
        return this.isConnected && this.client && this.client.isReady;
    }

    // ==================== User State Management ====================

    /**
     * Set user state with optional TTL
     * @param {number} userId - Telegram user ID
     * @param {object} state - State object
     * @param {number} ttl - Time to live in seconds (default: 1 hour)
     */
    async setUserState(userId, state, ttl = 86400) {
        try {
            if (!this.isReady()) {
                throw new Error('Redis not connected');
            }

            const key = `user_state:${userId}`;
            const stateData = {
                ...state,
                updatedAt: new Date().toISOString()
            };

            await this.client.setEx(key, ttl, JSON.stringify(stateData));

            global.logger.logInfo('User state updated', { userId, state: state.current });
            return true;
        } catch (error) {
            global.logger.logError('Failed to set user state:', error);
            return false;
        }
    }

    /**
     * Get user state
     * @param {number} userId - Telegram user ID
     */
    async getUserState(userId) {
        try {
            if (!this.isReady()) {
                return null;
            }

            const key = `user_state:${userId}`;
            const stateJson = await this.client.get(key);

            if (!stateJson) {
                return null;
            }

            const state = JSON.parse(stateJson);
            return state;
        } catch (error) {
            global.logger.logError('Failed to get user state:', error);
            return null;
        }
    }

    /**
     * Delete user state
     * @param {number} userId - Telegram user ID
     */
    async deleteUserState(userId) {
        try {
            if (!this.isReady()) {
                return false;
            }

            const key = `user_state:${userId}`;
            const result = await this.client.del(key);

            global.logger.logInfo('User state deleted', { userId });
            return result > 0;
        } catch (error) {
            global.logger.logError('Failed to delete user state:', error);
            return false;
        }
    }

    /**
     * Update user state field
     * @param {number} userId - Telegram user ID
     * @param {string} field - Field to update
     * @param {any} value - New value
     */
    async updateUserStateField(userId, field, value) {
        try {
            const currentState = await this.getUserState(userId);
            if (!currentState) {
                return false;
            }

            currentState[field] = value;
            currentState.updatedAt = new Date().toISOString();

            return await this.setUserState(userId, currentState);
        } catch (error) {
            global.logger.logError('Failed to update user state field:', error);
            return false;
        }
    }

    // ==================== Registration Data Management ====================

    /**
     * Store temporary registration data
     * @param {number} userId - Telegram user ID
     * @param {object} data - Registration data
     * @param {number} ttl - Time to live in seconds (default: 2 hours)
     */
    async setRegistrationData(userId, data, ttl = 7200) {
        try {
            if (!this.isReady()) {
                throw new Error('Redis not connected');
            }

            const key = `reg_data:${userId}`;
            const regData = {
                ...data,
                updatedAt: new Date().toISOString()
            };

            await this.client.setEx(key, ttl, JSON.stringify(regData));
            return true;
        } catch (error) {
            global.logger.logError('Failed to set registration data:', error);
            return false;
        }
    }

    /**
     * Get temporary registration data
     * @param {number} userId - Telegram user ID
     */
    async getRegistrationData(userId) {
        try {
            if (!this.isReady()) {
                return null;
            }

            const key = `reg_data:${userId}`;
            const dataJson = await this.client.get(key);

            if (!dataJson) {
                return null;
            }

            return JSON.parse(dataJson);
        } catch (error) {
            global.logger.logError('Failed to get registration data:', error);
            return null;
        }
    }

    /**
     * Delete registration data
     * @param {number} userId - Telegram user ID
     */
    async deleteRegistrationData(userId) {
        try {
            if (!this.isReady()) {
                return false;
            }

            const key = `reg_data:${userId}`;
            const result = await this.client.del(key);
            return result > 0;
        } catch (error) {
            global.logger.logError('Failed to delete registration data:', error);
            return false;
        }
    }

    // ==================== General Cache Operations ====================

    /**
     * Set cache value with TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds
     */
    async setCache(key, value, ttl = 3600) {
        try {
            if (!this.isReady()) {
                return false;
            }

            const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
            await this.client.setEx(key, ttl, serializedValue);
            return true;
        } catch (error) {
            global.logger.logError('Failed to set cache:', error);
            return false;
        }
    }

    /**
     * Get cache value
     * @param {string} key - Cache key
     * @param {boolean} parseJson - Whether to parse as JSON
     */
    async getCache(key, parseJson = true) {
        try {
            if (!this.isReady()) {
                return null;
            }

            const value = await this.client.get(key);
            if (!value) {
                return null;
            }

            return parseJson ? JSON.parse(value) : value;
        } catch (error) {
            global.logger.logError('Failed to get cache:', error);
            return null;
        }
    }

    /**
     * Delete cache key
     * @param {string} key - Cache key
     */
    async deleteCache(key) {
        try {
            if (!this.isReady()) {
                return false;
            }

            const result = await this.client.del(key);
            return result > 0;
        } catch (error) {
            global.logger.logError('Failed to delete cache:', error);
            return false;
        }
    }

    // ==================== Utility Methods ====================

    /**
     * Get all keys matching pattern
     * @param {string} pattern - Redis key pattern
     */
    async getKeys(pattern) {
        try {
            if (!this.isReady()) {
                return [];
            }

            return await this.client.keys(pattern);
        } catch (error) {
            global.logger.logError('Failed to get keys:', error);
            return [];
        }
    }

    /**
     * Check if key exists
     * @param {string} key - Redis key
     */
    async exists(key) {
        try {
            if (!this.isReady()) {
                return false;
            }

            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            global.logger.logError('Failed to check key existence:', error);
            return false;
        }
    }

    /**
     * Set TTL for existing key
     * @param {string} key - Redis key
     * @param {number} ttl - Time to live in seconds
     */
    async setTTL(key, ttl) {
        try {
            if (!this.isReady()) {
                return false;
            }

            const result = await this.client.expire(key, ttl);
            return result === 1;
        } catch (error) {
            global.logger.logError('Failed to set TTL:', error);
            return false;
        }
    }

    /**
     * Get Redis info
     */
    async getInfo() {
        try {
            if (!this.isReady()) {
                return null;
            }

            const info = await this.client.info();
            return info;
        } catch (error) {
            global.logger.logError('Failed to get Redis info:', error);
            return null;
        }
    }
}

// Create singleton instance
const redisService = new RedisService();

module.exports = redisService;