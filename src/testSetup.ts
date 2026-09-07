// Let React's act() flushes behave consistently across every jsdom test.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
