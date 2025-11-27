/**
 * DemoScript - AI-directed video demo system
 *
 * Public API for programmatic usage.
 */

export { parseScript, parseScriptString, validateScript, estimateDuration } from './schema/demo.js';
export { DemoRunner } from './runner/runner.js';
export { PrompterServer } from './prompter/server.js';
export * from './timeline/timeline.js';
