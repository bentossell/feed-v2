/**
 * Demo Script Schema and Validation
 *
 * Defines the structure of demo YAML files and provides validation.
 */

import yaml from 'js-yaml';
import fs from 'fs/promises';
import path from 'path';

// Valid step types
export const STEP_TYPES = ['command', 'pause', 'type', 'keypress', 'wait', 'clear'];

// Valid markers
export const MARKERS = ['speech', 'silence', 'speech_during'];

// Valid edit hints
export const EDIT_HINTS = ['zoom_region', 'speed', 'cut_if_long', 'highlight'];

/**
 * Parse duration string to milliseconds
 * Supports: "2s", "500ms", "1.5s", "2m", "1m30s"
 */
export function parseDuration(duration) {
  if (typeof duration === 'number') return duration;
  if (!duration) return 0;

  const str = String(duration).toLowerCase().trim();

  // Handle compound durations like "1m30s"
  const minMatch = str.match(/(\d+(?:\.\d+)?)\s*m(?:in)?/);
  const secMatch = str.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?/);
  const msMatch = str.match(/(\d+(?:\.\d+)?)\s*ms/);

  let total = 0;

  if (msMatch && !secMatch) {
    // Pure ms value
    total = parseFloat(msMatch[1]);
  } else {
    if (minMatch) total += parseFloat(minMatch[1]) * 60000;
    if (secMatch) total += parseFloat(secMatch[1]) * 1000;
    if (msMatch) total += parseFloat(msMatch[1]);
  }

  // If no units found, assume seconds
  if (total === 0 && /^\d+(?:\.\d+)?$/.test(str)) {
    total = parseFloat(str) * 1000;
  }

  return Math.round(total);
}

/**
 * Default config values
 */
export const DEFAULT_CONFIG = {
  typing_speed: 80,        // ms between keystrokes
  typing_variance: 30,     // random variance for realism
  post_command_pause: 1000, // pause after each command completes
  post_output_pause: 2000,  // pause after significant output
  shell: process.env.SHELL || '/bin/bash',
};

/**
 * Parse and validate a demo script
 */
export async function parseScript(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const script = yaml.load(content);

  return validateScript(script, filePath);
}

/**
 * Parse a demo script from a string
 */
export function parseScriptString(content) {
  const script = yaml.load(content);
  return validateScript(script, '<string>');
}

/**
 * Validate a parsed script object
 */
export function validateScript(script, source = '<unknown>') {
  const errors = [];

  if (!script || typeof script !== 'object') {
    throw new Error(`Invalid script: expected object, got ${typeof script}`);
  }

  // Validate meta
  if (!script.meta) {
    script.meta = { title: 'Untitled Demo' };
  }
  if (!script.meta.title) {
    script.meta.title = 'Untitled Demo';
  }

  // Parse estimated duration if present
  if (script.meta.estimated_duration) {
    script.meta.estimated_duration_ms = parseDuration(script.meta.estimated_duration);
  }

  // Merge config with defaults
  script.config = { ...DEFAULT_CONFIG };
  if (script.config) {
    // Parse duration values in config
    for (const key of ['typing_speed', 'typing_variance', 'post_command_pause', 'post_output_pause']) {
      if (script.config[key] !== undefined) {
        script.config[key] = parseDuration(script.config[key]);
      }
    }
  }

  // Validate steps
  if (!script.steps || !Array.isArray(script.steps)) {
    throw new Error(`Invalid script: 'steps' must be an array`);
  }

  if (script.steps.length === 0) {
    throw new Error(`Invalid script: 'steps' cannot be empty`);
  }

  // Track step IDs for uniqueness
  const stepIds = new Set();

  script.steps = script.steps.map((step, index) => {
    const validated = validateStep(step, index, errors);

    // Check for duplicate IDs
    if (validated.id) {
      if (stepIds.has(validated.id)) {
        errors.push(`Step ${index}: duplicate id '${validated.id}'`);
      }
      stepIds.add(validated.id);
    }

    return validated;
  });

  if (errors.length > 0) {
    const errorMsg = `Script validation failed (${source}):\n` + errors.map(e => `  - ${e}`).join('\n');
    throw new Error(errorMsg);
  }

  return script;
}

/**
 * Validate a single step
 */
function validateStep(step, index, errors) {
  if (!step || typeof step !== 'object') {
    errors.push(`Step ${index}: expected object, got ${typeof step}`);
    return step;
  }

  // Generate ID if not provided
  if (!step.id) {
    step.id = `step_${index}`;
  }

  // Validate type
  if (!step.type) {
    errors.push(`Step ${index} (${step.id}): missing 'type'`);
  } else if (!STEP_TYPES.includes(step.type)) {
    errors.push(`Step ${index} (${step.id}): invalid type '${step.type}'. Valid types: ${STEP_TYPES.join(', ')}`);
  }

  // Validate based on type
  switch (step.type) {
    case 'command':
      if (!step.text) {
        errors.push(`Step ${index} (${step.id}): 'command' type requires 'text'`);
      }
      // Parse timeout if present
      if (step.timeout) {
        step.timeout_ms = parseDuration(step.timeout);
      } else {
        step.timeout_ms = 30000; // 30s default
      }
      break;

    case 'pause':
      if (!step.duration) {
        errors.push(`Step ${index} (${step.id}): 'pause' type requires 'duration'`);
      } else {
        step.duration_ms = parseDuration(step.duration);
      }
      break;

    case 'type':
      if (!step.text) {
        errors.push(`Step ${index} (${step.id}): 'type' type requires 'text'`);
      }
      break;

    case 'keypress':
      if (!step.key) {
        errors.push(`Step ${index} (${step.id}): 'keypress' type requires 'key'`);
      }
      break;

    case 'wait':
      if (!step.wait_for) {
        errors.push(`Step ${index} (${step.id}): 'wait' type requires 'wait_for'`);
      }
      if (step.timeout) {
        step.timeout_ms = parseDuration(step.timeout);
      } else {
        step.timeout_ms = 30000;
      }
      break;

    case 'clear':
      // No additional validation needed
      break;
  }

  // Validate marker if present
  if (step.marker && !MARKERS.includes(step.marker)) {
    errors.push(`Step ${index} (${step.id}): invalid marker '${step.marker}'. Valid markers: ${MARKERS.join(', ')}`);
  }

  // Default marker based on type
  if (!step.marker) {
    step.marker = step.type === 'pause' ? 'speech' : 'silence';
  }

  return step;
}

/**
 * Calculate estimated total duration from script
 */
export function estimateDuration(script) {
  let total = 0;
  const config = script.config;

  for (const step of script.steps) {
    switch (step.type) {
      case 'pause':
        total += step.duration_ms || 0;
        break;

      case 'command':
        // Estimate typing time
        const chars = (step.text || '').length;
        total += chars * (config.typing_speed + config.typing_variance / 2);
        total += config.post_command_pause;
        // Add some buffer for command execution
        total += 2000;
        break;

      case 'type':
        const typeChars = (step.text || '').length;
        total += typeChars * (config.typing_speed + config.typing_variance / 2);
        break;

      case 'keypress':
        total += 200; // Brief pause for keypress
        break;

      case 'wait':
        // Can't estimate, use timeout/2 as rough guess
        total += (step.timeout_ms || 30000) / 2;
        break;

      case 'clear':
        total += 500;
        break;
    }
  }

  return total;
}

export default {
  parseScript,
  parseScriptString,
  validateScript,
  parseDuration,
  estimateDuration,
  STEP_TYPES,
  MARKERS,
  EDIT_HINTS,
  DEFAULT_CONFIG,
};
