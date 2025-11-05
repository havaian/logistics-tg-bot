/**
 * Centralized keyboard manager that can recreate keyboards for any state/step
 */
class KeyboardManager {

    /**
     * Show appropriate keyboard for given state and step
     * @param {Object} ctx - Telegraf context
     * @param {string} state - Current state
     * @param {string} step - Current step within state
     * @param {Object} stateData - Additional state data
     */
    async showKeyboardForState(ctx, state, step, stateData = {}) {
        try {
            switch (state) {
                case 'role_selection':
                    await this.showRoleSelectionKeyboard(ctx);
                    break;

                case 'basic_info':
                    await this.showBasicInfoKeyboard(ctx, step, stateData);
                    break;

                case 'first_order':
                    await this.showFirstOrderKeyboard(ctx, step, stateData);
                    break;

                case 'first_offer':
                    await this.showFirstOfferKeyboard(ctx, step, stateData);
                    break;

                default:
                    global.logger.logWarning(`Unknown state for keyboard: ${state}`, ctx);
            }
        } catch (error) {
            global.logger.logError('Error showing keyboard for state:', ctx, error);
        }
    }

    /**
     * Show role selection keyboard
     */
    async showRoleSelectionKeyboard(ctx) {
        const keyboard = [
            [{ text: global.i18n.t(ctx, 'registration.role_client') }],
            [{ text: global.i18n.t(ctx, 'registration.role_driver') }]
        ];

        await ctx.reply(
            global.i18n.t(ctx, 'start.choose_role'),
            {
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        );
    }

    /**
     * Show appropriate keyboard for basic info collection
     */
    async showBasicInfoKeyboard(ctx, step, stateData) {
        switch (step) {
            case 'first_name':
                await ctx.reply(global.i18n.t(ctx, 'registration.enter_first_name'));
                break;

            case 'last_name':
                await ctx.reply(global.i18n.t(ctx, 'registration.enter_last_name'));
                break;

            case 'birth_year':
                await ctx.reply(global.i18n.t(ctx, 'registration.enter_birth_year'));
                break;

            case 'phone':
                const contactKeyboard = [
                    [{ text: global.i18n.t(ctx, 'registration.contact_button'), request_contact: true }]
                ];

                await ctx.reply(
                    global.i18n.t(ctx, 'registration.share_contact'),
                    {
                        reply_markup: {
                            keyboard: contactKeyboard,
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;

            default:
                global.logger.logWarning(`Unknown basic_info step: ${step}`, ctx);
                await ctx.reply(global.i18n.t(ctx, 'registration.enter_first_name'));
        }
    }

    /**
     * Show appropriate keyboard for first order creation
     */
    async showFirstOrderKeyboard(ctx, step, stateData) {
        switch (step) {
            case 'from_location':
                await ctx.reply(global.i18n.t(ctx, 'orders.enter_from'));
                break;

            case 'to_location':
                const toKeyboard = [[{ text: global.i18n.t(ctx, 'orders.skip') }]];
                await ctx.reply(
                    global.i18n.t(ctx, 'orders.enter_to'),
                    {
                        reply_markup: {
                            keyboard: toKeyboard,
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;

            case 'description':
                const descKeyboard = [[{ text: global.i18n.t(ctx, 'orders.skip') }]];
                await ctx.reply(
                    global.i18n.t(ctx, 'orders.enter_description'),
                    {
                        reply_markup: {
                            keyboard: descKeyboard,
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;

            case 'price':
                const priceKeyboard = [[{ text: global.i18n.t(ctx, 'orders.skip') }]];
                await ctx.reply(
                    global.i18n.t(ctx, 'orders.enter_price'),
                    {
                        reply_markup: {
                            keyboard: priceKeyboard,
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;

            default:
                global.logger.logWarning(`Unknown first_order step: ${step}`, ctx);
                await ctx.reply(global.i18n.t(ctx, 'orders.enter_from'));
        }
    }

    /**
     * Show appropriate keyboard for first offer creation
     */
    async showFirstOfferKeyboard(ctx, step, stateData) {
        switch (step) {
            case 'vehicle_model':
                await ctx.reply(global.i18n.t(ctx, 'registration.enter_vehicle_model'));
                break;

            case 'vehicle_category':
                const keyboard = [
                    [{ text: global.i18n.t(ctx, 'registration.vehicle_categories.light') }],
                    [{ text: global.i18n.t(ctx, 'registration.vehicle_categories.medium') }],
                    [{ text: global.i18n.t(ctx, 'registration.vehicle_categories.heavy') }],
                    [{ text: global.i18n.t(ctx, 'registration.vehicle_categories.special') }]
                ];

                await ctx.reply(
                    global.i18n.t(ctx, 'registration.choose_vehicle_category'),
                    {
                        reply_markup: {
                            keyboard: keyboard,
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                break;

            case 'current_location':
                await ctx.reply(
                    global.i18n.t(ctx, 'registration.enter_current_location'),
                    { reply_markup: { remove_keyboard: true } }
                );
                break;

            default:
                global.logger.logWarning(`Unknown first_offer step: ${step}`, ctx);
                await ctx.reply(global.i18n.t(ctx, 'registration.enter_vehicle_model'));
        }
    }

    /**
     * Remove any existing keyboard
     */
    async removeKeyboard(ctx, message = null) {
        if (message) {
            await ctx.reply(message, { reply_markup: { remove_keyboard: true } });
        } else {
            await ctx.reply('', { reply_markup: { remove_keyboard: true } });
        }
    }

    /**
     * Get the next expected message type for a given state/step
     * Useful for validation and error handling
     */
    getExpectedInputType(state, step) {
        const inputTypes = {
            'role_selection': 'role_button',
            'basic_info': {
                'first_name': 'text',
                'last_name': 'text',
                'birth_year': 'number',
                'phone': 'contact'
            },
            'first_order': {
                'from_location': 'text',
                'to_location': 'text_or_skip',
                'description': 'text_or_skip',
                'price': 'number_or_skip'
            },
            'first_offer': {
                'vehicle_model': 'text',
                'vehicle_category': 'category_button',
                'current_location': 'text'
            }
        };

        if (typeof inputTypes[state] === 'string') {
            return inputTypes[state];
        } else if (typeof inputTypes[state] === 'object' && inputTypes[state][step]) {
            return inputTypes[state][step];
        }

        return 'unknown';
    }

    /**
     * Validate if received input matches expected type
     */
    validateInput(ctx, state, step, messageText) {
        const expectedType = this.getExpectedInputType(state, step);

        switch (expectedType) {
            case 'text':
                return messageText && messageText.trim().length >= 2;

            case 'number':
                return !isNaN(parseInt(messageText));

            case 'contact':
                return ctx.message.contact && ctx.message.contact.user_id === ctx.from.id;

            case 'role_button':
                return messageText === global.i18n.t(ctx, 'registration.role_client') ||
                    messageText === global.i18n.t(ctx, 'registration.role_driver');

            case 'category_button':
                const validCategories = [
                    global.i18n.t(ctx, 'registration.vehicle_categories.light'),
                    global.i18n.t(ctx, 'registration.vehicle_categories.medium'),
                    global.i18n.t(ctx, 'registration.vehicle_categories.heavy'),
                    global.i18n.t(ctx, 'registration.vehicle_categories.special')
                ];
                return validCategories.includes(messageText);

            case 'text_or_skip':
                return messageText && (messageText.trim().length >= 2 || messageText === global.i18n.t(ctx, 'orders.skip'));

            case 'number_or_skip':
                return messageText && (!isNaN(parseInt(messageText)) || messageText === global.i18n.t(ctx, 'orders.skip'));

            default:
                return true; // Unknown type, allow it
        }
    }
}

module.exports = new KeyboardManager();