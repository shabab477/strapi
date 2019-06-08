'use strict';

/**
 * Gzip hook
 */

module.exports = strapi => {
  return {
    /**
     * Initialize the hook
     */

    initialize() {
      strapi.app.use(strapi.koaMiddlewares.compress());
    },
  };
};
