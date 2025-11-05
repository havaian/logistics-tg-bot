const i18n = require('../i18n');

const t = (ctx, key, interpolations = {}) => {
    const locale = ctx.locale || 'ru';
    return i18n.t(key, locale, interpolations);
};

global.i18n = { t };

module.exports = { t };