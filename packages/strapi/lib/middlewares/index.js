'use strict';

const {
  after,
  includes,
  indexOf,
  drop,
  dropRight,
  uniq,
  defaultsDeep,
  get,
  set,
  isUndefined,
  merge,
} = require('lodash');

/* eslint-disable prefer-template */
module.exports = async function() {
  // Set if is admin destination for middleware application.
  this.app.use(async (ctx, next) => {
    if (ctx.request.header['origin'] === 'http://localhost:4000') {
      ctx.request.header['x-forwarded-host'] = 'strapi';
    }

    ctx.request.admin = ctx.request.header['x-forwarded-host'] === 'strapi';

    await next();
  });

  /** Utils */

  const middleWareConfig = this.config.middleware;

  const middlewareEnabled = key =>
    get(middleWareConfig, ['settings', key, 'enabled'], false) === true;

  const middlewareExists = key => {
    return !isUndefined(this.middleware[key]);
  };

  // Method to initialize middlewares and emit an event.
  const initialize = (module, middleware) => (resolve, reject) => {
    let timeout = true;

    setTimeout(() => {
      if (timeout) {
        reject(`(middleware: ${middleware}) takes too long to load`);
      }
    }, this.config.middleware.timeout || 1000);

    this.middleware[middleware] = merge(this.middleware[middleware], module);

    module.initialize.call(module, err => {
      timeout = false;

      if (err) {
        this.emit('middleware:' + middleware + ':error');

        return reject(err);
      }

      this.middleware[middleware].loaded = true;
      this.emit('middleware:' + middleware + ':loaded');
      // Remove listeners.
      this.removeAllListeners('middleware:' + middleware + ':loaded');

      resolve();
    });
  };

  const enabledMiddlewares = Object.keys(this.middleware).filter(
    middlewareEnabled
  );

  // Run beforeInitialize of every middleware
  await Promise.all(
    enabledMiddlewares.map(key => {
      const { beforeInitialize } = this.middleware[key].load;
      if (typeof beforeInitialize === 'function') {
        return beforeInitialize();
      }
    })
  );

  await Promise.all(
    enabledMiddlewares.map(
      key =>
        new Promise((resolve, reject) => {
          const module = this.middleware[key].load;

          // Retrieve middlewares configurations order
          const middlewaresBefore = get(middleWareConfig, 'load.before', [])
            .filter(middlewareExists)
            .filter(middlewareEnabled);

          const middlewaresOrder = get(middleWareConfig, 'load.order', [])
            .filter(middlewareExists)
            .filter(middlewareEnabled);

          const middlewaresAfter = get(middleWareConfig, 'load.after', [])
            .filter(middlewareExists)
            .filter(middlewareEnabled);

          // Apply default configurations to middleware.
          if (isUndefined(get(middleWareConfig, ['settings', key]))) {
            set(middleWareConfig, ['settings', key], {});
          }

          if (module.defaults && middleWareConfig.settings[key] !== false) {
            defaultsDeep(
              middleWareConfig.settings[key],
              module.defaults[key] || module.defaults
            );
          }

          // Initialize array.
          let previousDependencies = [];

          // Add BEFORE middlewares to load and remove the current one
          // to avoid that it waits itself.
          if (includes(middlewaresBefore, key)) {
            const position = indexOf(middlewaresBefore, key);

            previousDependencies = previousDependencies.concat(
              dropRight(middlewaresBefore, middlewaresBefore.length - position)
            );
          } else {
            previousDependencies = previousDependencies.concat(
              middlewaresBefore.filter(x => x !== key)
            );

            // Add ORDER dependencies to load and remove the current one
            // to avoid that it waits itself.
            if (includes(middlewaresOrder, key)) {
              const position = indexOf(middlewaresOrder, key);

              previousDependencies = previousDependencies.concat(
                dropRight(middlewaresOrder, middlewaresOrder.length - position)
              );
            } else {
              // Add AFTER middlewares to load and remove the current one
              // to avoid that it waits itself.
              if (includes(middlewaresAfter, key)) {
                const position = indexOf(middlewaresAfter, key);
                const toLoadAfter = drop(middlewaresAfter, position);

                // Wait for every middlewares.
                previousDependencies = previousDependencies.concat(
                  enabledMiddlewares
                );
                // Exclude middlewares which need to be loaded after this one.
                previousDependencies = previousDependencies.filter(
                  x => !includes(toLoadAfter, x)
                );
              }
            }
          }

          // Remove duplicates.
          previousDependencies = uniq(previousDependencies);

          if (previousDependencies.length === 0) {
            initialize(module, key)(resolve, reject);
          } else {
            // Wait until the dependencies have been loaded.
            const queue = after(previousDependencies.length, () => {
              initialize(module, key)(resolve, reject);
            });

            previousDependencies.forEach(dependency => {
              // Some hooks are already loaded, we won't receive
              // any events of them, so we have to bypass the emitter.
              if (this.middleware[dependency].loaded === true) {
                return queue();
              }

              this.once('middleware:' + dependency + ':loaded', () => {
                queue();
              });
            });
          }
        })
    )
  );
};
