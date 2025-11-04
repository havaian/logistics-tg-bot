const User = require('../models/user');
// Import logger
const { logError } = require('../logger');

const detectUserLanguage = async (ctx, next) => {
    try {
        let userLocale = 'ru'; // Default to Russian

        // Detect language for private chats and groups
        if (ctx.from) {
            // First, try to get language from user profile (if user exists)
            const user = await User.findOne({ telegramId: ctx.from.id });
            if (user && user.language) {
                userLocale = user.language;
            } else {
                // Detect from Telegram language_code if no user profile or language set
                const telegramLocale = ctx.from.language_code;

                if (telegramLocale) {
                    // Map Telegram locales to our supported locales
                    const localeMap = {
                        'ru': 'ru',
                        'uz': 'uz',
                        'en': 'en'
                    };

                    const detectedLocale = localeMap[telegramLocale.split('-')[0]];
                    if (detectedLocale) {
                        userLocale = detectedLocale;

                        // Save detected language to user profile (only for private chats)
                        if (user && ctx.chat && ctx.chat.type === 'private') {
                            user.language = userLocale;
                            await user.save();
                        }
                    }
                }
            }
        }

        // Add locale to context
        ctx.locale = userLocale;

        return next();
    } catch (error) {
        logError('Error in language detection middleware:', error);
        ctx.locale = 'ru'; // Fallback to Russian
        return next();
    }
};

module.exports = { detectUserLanguage };