#!/usr/bin/env node

/**
 * DemoScript CLI
 *
 * AI-directed video demo system - execute demo scripts with human-like timing
 * and synchronized teleprompter.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { parseScript, estimateDuration } from './schema/demo.js';
import { DemoRunner } from './runner/runner.js';
import { TerminalRecorder } from './runner/recorder.js';
import { saveAllOutputs, loadTimeline } from './timeline/timeline.js';
import { PrompterServer } from './prompter/server.js';

const program = new Command();

program
  .name('demoscript')
  .description('AI-directed video demo system')
  .version('0.1.0');

/**
 * Validate command - check a demo script for errors
 */
program
  .command('validate <script>')
  .description('Validate a demo script YAML file')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (scriptPath, options) => {
    try {
      const fullPath = path.resolve(scriptPath);
      console.log(chalk.blue(`Validating ${fullPath}...`));

      const script = await parseScript(fullPath);

      console.log(chalk.green('✓ Script is valid'));
      console.log();
      console.log(chalk.bold('Summary:'));
      console.log(`  Title: ${script.meta.title}`);
      console.log(`  Steps: ${script.steps.length}`);
      console.log(`  Estimated duration: ${Math.round(estimateDuration(script) / 1000)}s`);

      if (options.verbose) {
        console.log();
        console.log(chalk.bold('Steps:'));
        for (const step of script.steps) {
          const marker = step.marker === 'speech' ? '🎤' : step.marker === 'speech_during' ? '🗣️' : '🔇';
          console.log(`  ${marker} [${step.type}] ${step.id}`);
          if (step.text) {
            console.log(`     ${chalk.dim(step.text.substring(0, 50))}${step.text.length > 50 ? '...' : ''}`);
          }
          if (step.prompt) {
            console.log(`     ${chalk.cyan('Prompt:')} "${step.prompt.substring(0, 40)}..."`);
          }
        }
      }

    } catch (error) {
      console.error(chalk.red('✗ Validation failed:'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

/**
 * Run command - execute a demo script
 */
program
  .command('run <script>')
  .description('Execute a demo script')
  .option('-o, --output <dir>', 'Output directory for recordings', './recordings')
  .option('-n, --name <name>', 'Base name for output files', 'demo')
  .option('--dry-run', 'Print what would happen without executing')
  .option('-v, --verbose', 'Show detailed output')
  .option('-r, --record', 'Record terminal to video (requires ffmpeg)')
  .option('--fps <fps>', 'Video frame rate', '10')
  .option('--width <width>', 'Video width', '1280')
  .option('--height <height>', 'Video height', '720')
  .option('--prompter', 'Start teleprompter server')
  .option('--prompter-port <port>', 'Teleprompter server port', '3456')
  .action(async (scriptPath, options) => {
    try {
      const fullPath = path.resolve(scriptPath);
      console.log(chalk.blue(`Loading ${fullPath}...`));

      const script = await parseScript(fullPath);
      console.log(chalk.green(`✓ Loaded: ${script.meta.title}`));
      console.log(`  ${script.steps.length} steps, ~${Math.round(estimateDuration(script) / 1000)}s estimated`);
      console.log();

      // Create output directory
      const outputDir = path.resolve(options.output);
      await fs.mkdir(outputDir, { recursive: true });

      // Start teleprompter if requested
      let prompter = null;
      if (options.prompter) {
        prompter = new PrompterServer({
          port: parseInt(options.prompterPort, 10),
        });
        await prompter.start();
        console.log(chalk.cyan(`Teleprompter: http://localhost:${options.prompterPort}`));
        console.log();
      }

      // Start recorder if requested
      let recorder = null;
      if (options.record && !options.dryRun) {
        recorder = new TerminalRecorder({
          fps: parseInt(options.fps, 10),
          width: parseInt(options.width, 10),
          height: parseInt(options.height, 10),
        });
        console.log(chalk.cyan(`Recording video: ${options.width}x${options.height} @ ${options.fps}fps`));
      }

      // Create runner
      const runner = new DemoRunner(script, {
        outputDir,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      // Wire up events
      runner.on('start', ({ timestamp }) => {
        console.log(chalk.green('▶ Demo started'));
        if (recorder) {
          recorder.start();
        }
      });

      runner.on('step-start', ({ step, index, timestamp }) => {
        const marker = step.marker === 'speech' ? '🎤' : step.marker === 'speech_during' ? '🗣️' : '🔇';
        console.log(`${marker} [${index + 1}/${script.steps.length}] ${step.id} (${step.type})`);

        if (prompter) {
          prompter.onStepStart(step, timestamp);
        }
      });

      runner.on('step-end', ({ step, index, duration }) => {
        if (options.verbose) {
          console.log(chalk.dim(`   completed in ${Math.round(duration)}ms`));
        }
      });

      runner.on('output', (data) => {
        if (options.verbose) {
          process.stdout.write(chalk.dim(data));
        }
        if (recorder) {
          recorder.addOutput(data);
        }
      });

      runner.on('complete', async ({ timeline, duration }) => {
        console.log();
        console.log(chalk.green(`✓ Demo completed in ${(duration / 1000).toFixed(1)}s`));

        if (!options.dryRun) {
          // Save output files
          const files = await saveAllOutputs(timeline, outputDir, options.name);
          console.log();
          console.log(chalk.bold('Output files:'));
          console.log(`  Timeline: ${files.timeline}`);
          console.log(`  Markers:  ${files.markers}`);
          console.log(`  Hints:    ${files.hints}`);

          // Render video if recording
          if (recorder) {
            recorder.stop();
            console.log();
            const videoPath = path.join(outputDir, `${options.name}.mp4`);
            await recorder.render(videoPath);
            console.log(`  Video:    ${videoPath}`);
          }
        }
      });

      runner.on('error', ({ error, step }) => {
        console.error(chalk.red(`✗ Error at step ${step?.id || 'unknown'}:`));
        console.error(chalk.red(error.message));
      });

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n⚠ Aborted by user'));
        runner.abort();
        if (recorder) {
          recorder.stop();
        }
        if (prompter) {
          prompter.stop();
        }
        process.exit(0);
      });

      // Run the demo
      if (options.dryRun) {
        console.log(chalk.yellow('DRY RUN - not executing commands'));
        console.log();
      }

      const timeline = await runner.run();

      // Update prompter with final timeline
      if (prompter) {
        prompter.loadTimeline(timeline);
        console.log();
        console.log(chalk.cyan('Teleprompter is still running. Press Ctrl+C to stop.'));

        // Keep process alive for teleprompter
        await new Promise(() => {});
      }

    } catch (error) {
      console.error(chalk.red('✗ Run failed:'));
      console.error(chalk.red(error.message));
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

/**
 * Prompter command - start teleprompter server
 */
program
  .command('prompter')
  .description('Start the teleprompter server')
  .option('-p, --port <port>', 'Server port', '3456')
  .option('-t, --timeline <file>', 'Load timeline file')
  .option('--sync', 'Wait for live sync from demo runner')
  .action(async (options) => {
    try {
      const prompter = new PrompterServer({
        port: parseInt(options.port, 10),
      });

      await prompter.start();

      if (options.timeline) {
        await prompter.loadFromFile(path.resolve(options.timeline));
      }

      console.log(chalk.cyan('Teleprompter controls:'));
      console.log('  Space - Play/Pause');
      console.log('  R - Reset');
      console.log('  ← → - Seek ±5s');
      console.log();
      console.log(chalk.dim('Press Ctrl+C to stop'));

      // Keep process alive
      await new Promise(() => {});

    } catch (error) {
      console.error(chalk.red('✗ Failed to start teleprompter:'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

/**
 * Info command - show information about a timeline
 */
program
  .command('info <timeline>')
  .description('Show information about a timeline file')
  .action(async (timelinePath) => {
    try {
      const timeline = await loadTimeline(path.resolve(timelinePath));

      console.log(chalk.bold('Timeline Info'));
      console.log(`  Started: ${timeline.started_at}`);
      console.log(`  Steps: ${timeline.steps.length}`);

      const lastStep = timeline.steps[timeline.steps.length - 1];
      const duration = lastStep ? lastStep.ended_at : 0;
      console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);

      console.log();
      console.log(chalk.bold('Steps:'));
      for (const step of timeline.steps) {
        const dur = step.ended_at - step.started_at;
        const marker = step.marker === 'speech' ? '🎤' : step.marker === 'speech_during' ? '🗣️' : '🔇';
        console.log(`  ${marker} ${step.id} (${step.type}) - ${(dur / 1000).toFixed(1)}s`);
      }

      // Count speech cues
      const speechCues = timeline.steps.filter(s => s.prompt || s.prompt_after);
      console.log();
      console.log(`Speech cues: ${speechCues.length}`);

    } catch (error) {
      console.error(chalk.red('✗ Failed to load timeline:'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program.parse();
