export const DebugSettings = {
    DEBUG_MODE: __DEV__
};

export const debug = {
    log: (...args: unknown[]) => {
        if (DebugSettings.DEBUG_MODE) console.log('\x1b[36m[DEBUG]\x1b[0m', ...args);
    },
    info: (...args: unknown[]) => {
        if (DebugSettings.DEBUG_MODE) console.info('\x1b[32m[INFO]\x1b[0m', ...args);
    },
    warn: (...args: unknown[]) => {
        if (DebugSettings.DEBUG_MODE) console.warn('\x1b[33m[WARN]\x1b[0m', ...args);
    },
    error: (...args: unknown[]) => {
        if (DebugSettings.DEBUG_MODE) console.error('\x1b[31m[ERROR]\x1b[0m', ...args);
    }
};

export function debug_condition(forcedValue: boolean) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        const originalGetter = descriptor.get;

        if (typeof originalMethod === 'function') {
            descriptor.value = function (...args: any[]) {
                if (DebugSettings.DEBUG_MODE) {
                    debug.warn(`Override condition: '${propertyKey}()' is forced to return ${forcedValue}`);
                    return forcedValue;
                }
                return originalMethod.apply(this, args);
            };
        } 
        else if (typeof originalGetter === 'function') {
            descriptor.get = function () {
                if (DebugSettings.DEBUG_MODE) {
                    debug.warn(`Override condition: getter '${propertyKey}' is forced to return ${forcedValue}`);
                    return forcedValue;
                }
                return originalGetter.call(this);
            };
        }

        return descriptor;
    };
}