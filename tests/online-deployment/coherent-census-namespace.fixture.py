import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest
from urllib.parse import unquote, urlsplit

assert sys.platform == 'linux'
root = Path(sys.argv.pop(1)).resolve(strict=True)
spec = importlib.util.spec_from_file_location('census', root / 'online-backend-boundary.py')
census = importlib.util.module_from_spec(spec)
spec.loader.exec_module(census)
source = urlsplit(os.environ['DATABASE_URL'])
assert source.hostname == 'postgres' and (source.port or 5432) == 5432
environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
environment.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
                   PGPASSWORD=unquote(source.password), PGDATABASE=unquote(source.path[1:]),
                   PGAPPNAME='qa-census-namespace-filter', PGCONNECT_TIMEOUT='5',
                   PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000 -c search_path=pg_catalog')
first, second = 'sabalan-rt-' + 'a' * 48, 'sabalan-rt-' + 'b' * 48


class CensusNamespaces(unittest.TestCase):
    def count(self, names):
        predicate = census.namespace_predicate(names)
        query = "WITH sessions(application_name) AS (VALUES (''),('" + first + "'),('" + second + "'),('foreign')) "
        query += 'SELECT count(*) FROM sessions WHERE ' + predicate
        child = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query],
                               env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(child.returncode, 0, 'Bounded read-only PostgreSQL namespace query failed')
        self.assertLessEqual(len(child.stdout), 32)
        self.assertEqual(child.stderr, b'')
        return int(child.stdout.strip())

    def test_no_closed_runtimes_never_selects_an_unrelated_blank_namespace(self):
        self.assertEqual(self.count([]), 0)

    def test_one_closed_runtime_selects_only_its_exact_native_namespace(self):
        self.assertEqual(self.count([first]), 1)

    def test_multiple_owned_names_never_include_blank_or_foreign_sessions(self):
        self.assertEqual(self.count([first, second]), 2)

    def test_non_native_or_sql_namespace_input_refuses_before_query(self):
        for value in [[''], ['foreign'], [first + "' OR TRUE --"]]:
            self.assertRaises(RuntimeError, census.namespace_predicate, value)


unittest.main()
