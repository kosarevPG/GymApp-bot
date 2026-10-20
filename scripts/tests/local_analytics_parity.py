"""Only MemoryClient: the browser adapter must match the existing backend maths."""
import json
import sys
import uuid
from datetime import timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from test_supabase_store import SupabaseStoreTests, USER_ID, EXERCISE_ID

case = SupabaseStoreTests(); case.setUp()
store, client = case.store, case.client
store._clock = lambda: case.current + timedelta(days=2)
for i, offset in enumerate([34, 28, 21, 14, 7, 6, 0, 0, -1]):
    for j, (kind, weight, reps) in enumerate([('working', 2.25, 1), ('working', 16, 12), ('warmup', 10, 20), ('failure', 20, 5), ('working', 99, 1)]):
        data = case.payload(request_id=str(uuid.UUID(int=1000 + i * 10 + j)), session_id=f'parity-{i}', weight=weight,
            performed_at=(case.current - timedelta(days=offset)).isoformat())
        data.update(order=j + 1, set_type=kind, reps=reps)
        result = store.save_set(USER_ID, data)
        assert result['status'] == 'success', (i, j, result)
        if j == 4:
            client.tables['gym_sets'][-1]['include_in_tonnage'] = False
client.tables['gym_exercises'][0]['is_active'] = False
store._clock = lambda: case.current
assert client.tables['gym_exercises'][0]['id'] == EXERCISE_ID
history = store.get_global_history(USER_ID)
print(json.dumps({'referenceDate':case.current.date().isoformat(), 'history':history,
    'analytics':{str(days):store.get_analytics(USER_ID, days) for days in [7, 14, 28]}}))
