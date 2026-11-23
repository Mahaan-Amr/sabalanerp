import assert from 'node:assert/strict';
import test from 'node:test';
import { equivalentRecoverySchemas } from '../recoverySchemaIdentity';

test('schema identity ignores server patch-version metadata before the pg_dump SQL preamble', () => {
  const dump = (version: string) => `--\n-- PostgreSQL database dump\n--\n\n-- Dumped from database version ${version}\n-- Dumped by pg_dump version 15.15\n\nSET statement_timeout = 0;\nCREATE TABLE public.orders (id int);\n`;
  assert.equal(equivalentRecoverySchemas(dump('15.10'), dump('15.15')), true);
});

test('schema identity preserves metadata-shaped text inside function bodies', () => {
  const prefix = '--\n-- PostgreSQL database dump\n--\n\nSET statement_timeout = 0;\n';
  const dump = (body: string) => `${prefix}CREATE FUNCTION public.note() RETURNS text LANGUAGE sql AS $$ SELECT '\n${body}\n' $$;\n`;
  assert.equal(equivalentRecoverySchemas(dump('-- Dumped from database version 15.10'), dump('-- Dumped from database version 15.15')), false);
});
