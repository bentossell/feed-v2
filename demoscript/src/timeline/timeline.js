/**
 * Timeline Module - Handles timeline and marker file operations
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Save timeline to a JSON file
 */
export async function saveTimeline(timeline, outputPath) {
  const json = JSON.stringify(timeline, null, 2);
  await fs.writeFile(outputPath, json, 'utf-8');
}

/**
 * Load timeline from a JSON file
 */
export async function loadTimeline(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Extract markers from timeline
 */
export function extractMarkers(timeline) {
  return timeline.steps
    .filter(step => step.marker === 'speech' || step.marker === 'speech_during' || step.prompt || step.prompt_after)
    .map(step => ({
      id: step.id,
      type: step.type,
      marker: step.marker,
      prompt: step.prompt || null,
      prompt_after: step.prompt_after || null,
      started_at: step.started_at,
      ended_at: step.ended_at,
      duration: step.ended_at - step.started_at,
    }));
}

/**
 * Save markers to a JSON file
 */
export async function saveMarkers(timeline, outputPath) {
  const markers = extractMarkers(timeline);
  const json = JSON.stringify({
    started_at: timeline.started_at,
    markers,
  }, null, 2);
  await fs.writeFile(outputPath, json, 'utf-8');
}

/**
 * Generate edit hints from timeline
 */
export function generateEditHints(timeline) {
  return timeline.steps
    .filter(step => step.edit_hint)
    .map(step => ({
      id: step.id,
      hint: step.edit_hint,
      started_at: step.started_at,
      ended_at: step.ended_at,
      duration: step.ended_at - step.started_at,
    }));
}

/**
 * Save edit hints to a JSON file
 */
export async function saveEditHints(timeline, outputPath) {
  const hints = generateEditHints(timeline);
  const json = JSON.stringify({
    started_at: timeline.started_at,
    hints,
  }, null, 2);
  await fs.writeFile(outputPath, json, 'utf-8');
}

/**
 * Create all output files from a timeline
 */
export async function saveAllOutputs(timeline, outputDir, baseName = 'demo') {
  await fs.mkdir(outputDir, { recursive: true });

  const timelinePath = path.join(outputDir, `${baseName}-timeline.json`);
  const markersPath = path.join(outputDir, `${baseName}-markers.json`);
  const hintsPath = path.join(outputDir, `${baseName}-edit-hints.json`);

  await Promise.all([
    saveTimeline(timeline, timelinePath),
    saveMarkers(timeline, markersPath),
    saveEditHints(timeline, hintsPath),
  ]);

  return {
    timeline: timelinePath,
    markers: markersPath,
    hints: hintsPath,
  };
}

/**
 * Get the current cue at a given timestamp
 */
export function getCueAtTime(timeline, timestampMs) {
  for (const step of timeline.steps) {
    if (timestampMs >= step.started_at && timestampMs <= step.ended_at) {
      return {
        step,
        progress: (timestampMs - step.started_at) / (step.ended_at - step.started_at),
        remaining: step.ended_at - timestampMs,
      };
    }
  }
  return null;
}

/**
 * Get the next cue after a given timestamp
 */
export function getNextCue(timeline, timestampMs) {
  for (const step of timeline.steps) {
    if (step.started_at > timestampMs) {
      return step;
    }
  }
  return null;
}

/**
 * Get speech cues (for teleprompter)
 */
export function getSpeechCues(timeline) {
  const cues = [];

  for (const step of timeline.steps) {
    // Add prompt at start of step
    if (step.prompt) {
      cues.push({
        id: `${step.id}_prompt`,
        text: step.prompt,
        started_at: step.started_at,
        ended_at: step.ended_at,
        marker: step.marker,
      });
    }

    // Add prompt_after at end of step
    if (step.prompt_after) {
      cues.push({
        id: `${step.id}_prompt_after`,
        text: step.prompt_after,
        started_at: step.ended_at,
        ended_at: step.ended_at + 3000, // Give 3 seconds for the prompt_after
        marker: 'speech',
      });
    }

    // For silence steps, add a silence cue
    if (step.marker === 'silence' && !step.prompt && !step.prompt_after) {
      cues.push({
        id: `${step.id}_silence`,
        text: null,
        started_at: step.started_at,
        ended_at: step.ended_at,
        marker: 'silence',
      });
    }
  }

  return cues.sort((a, b) => a.started_at - b.started_at);
}

export default {
  saveTimeline,
  loadTimeline,
  extractMarkers,
  saveMarkers,
  generateEditHints,
  saveEditHints,
  saveAllOutputs,
  getCueAtTime,
  getNextCue,
  getSpeechCues,
};
