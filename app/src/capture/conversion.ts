/** A conversion step that took place, in step order. */
export type ConversionStep =
  | { readonly step: 'task_created'; readonly pageId: string }
  | { readonly step: 'origin_noted'; readonly commentId: string }
  | { readonly step: 'item_archived'; readonly pageId: string };

/**
 * A step that took place in an intent of the `capture` capability: conversion and closure share
 * the “origin comment” and “trash” steps, and parking an item adds its own.
 */
export type CaptureStep =
  ConversionStep | { readonly step: 'item_parked'; readonly pageId: string };
