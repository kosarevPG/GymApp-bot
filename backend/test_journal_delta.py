import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import index
import test_supabase_store as fixtures
from test_supabase_store import USER_ID, REQUEST_1


class JournalDeltaTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.SupabaseStoreTests(); self.case.setUp()
        self.client, self.store = self.case.client, self.case.store
        self.store.save_set(USER_ID, self.case.payload())

    def test_delta_uses_the_authenticated_owner_and_one_snapshot_call(self):
        session = copy.deepcopy(self.client.tables['gym_workout_sessions'][0])
        row = dict(session=session, groups=copy.deepcopy(self.client.tables['gym_set_groups']),
            sets=copy.deepcopy(self.client.tables['gym_sets']), exercises=copy.deepcopy(self.client.tables['gym_exercises']), cardio=[], revision='version')
        calls = []
        def read(name, arguments):
            calls.append((name, arguments))
            return dict(manifest={session['id']: 'version'}, changed=[] if arguments['p_known'] else [row])
        self.client.rpc_read = read
        before = len(self.client.select_calls)
        first = self.store.get_journal_delta(USER_ID, {})
        self.assertEqual(first['mode'], 'delta')
        self.assertEqual(first['upserts'][0]['syncVersion'], 'version')
        self.assertEqual(len(self.client.select_calls), before)
        second = self.store.get_journal_delta(USER_ID, first['manifest'])
        self.assertEqual(second['upserts'], [])
        self.assertTrue(all(c[1]['p_user_id'] == USER_ID for c in calls))

    def test_missing_migration_falls_back_but_transient_failures_do_not(self):
        def missing(*_): raise RuntimeError('PGRST202 function not found')
        self.client.rpc_read = missing
        self.assertEqual(self.store.get_journal_delta(USER_ID, {})['mode'], 'full')
        def failed(*_): raise RuntimeError('Supabase Data API returned 503')
        self.client.rpc_read = failed
        with self.assertRaises(RuntimeError): self.store.get_journal_delta(USER_ID, {})
        with self.assertRaises(ValueError): self.store.get_journal_delta(USER_ID, [])
        with self.assertRaises(ValueError): self.store.get_journal_delta(USER_ID, {'id': {'invalid': 'nested'}})

    def test_old_row_uuid_can_be_edited_but_not_by_another_owner(self):
        row = self.client.tables['gym_sets'][0]; row['client_request_id'] = None
        self.assertTrue(self.store.update_set(USER_ID, {'client_request_id': row['id'], 'reps': 13}))
        self.assertEqual(self.client.tables['gym_sets'][0]['reps'], 13)
        self.assertFalse(self.store.update_set('22222222-2222-4222-8222-222222222222', {'client_request_id': row['id'], 'reps': 99}))

    def test_route_ignores_a_user_id_supplied_in_the_request(self):
        with patch.object(index, 'authenticate_request', return_value=SimpleNamespace(user_id=USER_ID)), patch.object(index, 'get_journal_delta', return_value={'mode': 'delta'}) as read:
            result = index.handler({'httpMethod': 'POST', 'queryStringParameters': {'url': '/api/journal_sync'},
                'headers': {}, 'body': '{"known": {}, "user_id": "somebody-else"}'}, None)
        self.assertEqual(result['statusCode'], 200);read.assert_called_once_with(USER_ID, {})
