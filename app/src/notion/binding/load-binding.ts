import { parseDocument } from 'yaml';
import { z } from 'zod';
import { Binding, bindingOf } from './binding';
import { BindingError } from './binding.error';
import { bindingFileSchema } from './binding.schema';

/** Parses and validates the binding text, or throws with the full list of problems. */
export function loadBinding(text: string, origin: string): Binding {
  const document = parseDocument(text);

  // A duplicate key is not a YAML syntax error: the last one silently wins. In a file filled in by
  // hand, that is exactly how a binding gets lost without anyone noticing.
  const syntax = [...document.errors, ...document.warnings];
  if (syntax.length > 0) {
    throw new BindingError(
      origin,
      syntax.map((problem) => `yaml :: ${headline(problem.message)}`),
    );
  }

  const file = bindingFileSchema.safeParse(document.toJS());
  if (!file.success) {
    throw new BindingError(origin, file.error.issues.flatMap(problemsOf));
  }

  return bindingOf(file.data, origin);
}

/**
 * YAML adds a frame with a snippet of the file to the message. A list of dozens of lines needs a
 * one-line description, and the position is already in the description.
 */
function headline(message: string): string {
  return message.split('\n')[0].replace(/:$/, '');
}

/**
 * Describes a problem together with the path to its place in the file. Extra keys are expanded
 * into one line each, so the person sees which keys to remove, not “somewhere in the block”.
 */
function problemsOf(issue: z.core.$ZodIssue): string[] {
  const path = issue.path.map(String);

  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => `${[...path, key].join('.')} :: Unrecognized key`);
  }

  return [`${path.join('.') || '(file)'} :: ${issue.message}`];
}
