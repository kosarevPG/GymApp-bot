import unittest
import uuid
import test_supabase_store as fixtures
from test_supabase_store import USER_ID


class LocalAnalyticsHistoryTests(unittest.TestCase):
    def test_full_journal_exposes_flags_and_does_not_stop_at_3000_sets(self):
        case = fixtures.SupabaseStoreTests(); case.setUp()
        case.client.max_page_size = 500
        self.assertEqual(case.store.save_set(USER_ID, case.payload())['status'], 'success')
        template = case.client.tables['gym_sets'][0]
        case.client.tables['gym_sets'] = [dict(template, id=str(uuid.UUID(int=i+100)),
            client_request_id=str(uuid.UUID(int=i+10000)), position=i+1) for i in range(3001)]
        case.client.tables['gym_sets'][0]['include_in_tonnage'] = False
        journal = case.store.get_global_history(USER_ID)
        self.assertEqual(sum(len(e['sets']) for s in journal for e in s['exercises']), 3001)
        self.assertTrue(all(s['analyticsComplete'] for s in journal))
        self.assertEqual(journal[0]['exercises'][0]['muscleGroup'], 'Грудь')
        self.assertFalse(journal[0]['exercises'][0]['sets'][0]['include_in_tonnage'])
        self.assertFalse(case.store.get_global_history(USER_ID, limit_rows=1)[0]['analyticsComplete'])

    def test_calendar_window_is_consistent_at_midnight_and_ignores_future(self):
        case = fixtures.SupabaseStoreTests(); case.setUp()
        case.store.save_set(USER_ID, case.payload())
        case.client.tables['gym_workout_sessions'][0]['workout_date'] = '2026-08-15'
        case.current = case.current.replace(hour=0, minute=0)
        self.assertEqual(case.store.get_analytics(USER_ID, 7)['volume'], 0)
        case.client.tables['gym_workout_sessions'][0]['workout_date'] = '2026-08-16'
        self.assertEqual(case.store.get_analytics(USER_ID, 7)['volume'], 400)
        case.client.tables['gym_workout_sessions'][0]['workout_date'] = '2026-08-23'
        self.assertEqual(case.store.get_analytics(USER_ID, 7)['volume'], 0)
