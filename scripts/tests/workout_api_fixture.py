"""Loopback-only browser fixture. All writes stay in MemoryClient; no secrets/network."""
import copy
import json
import hashlib
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))
import index
import supabase_store
from test_supabase_store import MemoryClient, USER_ID
from scripts.restore_home_workout_20261012 import build_plan, OWNER

LOCK = threading.Lock()


def reset():
    client = MemoryClient(max_page_size=500)
    def snapshot_read(function, arguments):
        assert function == 'gym_journal_snapshot_v1'
        assert arguments['p_user_id'] == USER_ID
        manifest, changed = {}, []
        for session in client.tables['gym_workout_sessions']:
            if session['user_id'] != USER_ID:
                continue
            owned = lambda table: [r for r in client.tables[table] if r['user_id'] == USER_ID and r.get('session_id') == session['id']]
            sets, cardio = owned('gym_sets'), owned('gym_cardio_segments')
            exercise_ids = {r['exercise_id'] for r in sets + cardio}
            row = dict(session=session, sets=sets, cardio=cardio, groups=owned('gym_set_groups'),
                exercises=[e for e in client.tables['gym_exercises'] if e['user_id'] == USER_ID and e['id'] in exercise_ids])
            revision = hashlib.md5(json.dumps(row, sort_keys=True).encode()).hexdigest()
            manifest[session['id']] = revision
            if arguments.get('p_known', {}).get(session['id']) != revision:
                changed.append(dict(row, revision=revision))
        return dict(manifest=manifest, changed=changed)
    client.rpc_read = snapshot_read
    plan = build_plan(OWNER, confirmed_lateral_raises=True)
    client.tables["gym_workout_sessions"] = [dict(plan["session"], user_id=USER_ID)]
    client.tables["gym_set_groups"] = [dict(g, user_id=USER_ID) for g in plan["groups"]]
    client.tables["gym_exercises"] = [dict(id=e["id"], user_id=USER_ID, source="gymapp", source_key=e["key"] or e["id"],
        name_ru=e["name"], muscle_group=e["muscle"], weight_type=e["kind"], base_weight_kg=0, multiplier=e["mult"],
        tonnage_mode="external_load", is_active=True, measure="strength", source_payload={"reps_per_side": e["per_side"]}) for e in plan["exercises"]]
    client.tables["gym_sets"] = [dict(s, user_id=USER_ID, exercise_id=plan["exercises"][s["exercise_slot"]-1]["id"])
                                 for s in plan["sets"]]
    for key, name, kind, base, mult in (("bar", "Жим штанги", "Barbell", 20, 2),
                                      ("hack", "Приседания в Гакк", "Plate_Loaded", 40, 1)):
        client.tables["gym_exercises"].append(dict(id=str(uuid.uuid5(uuid.NAMESPACE_DNS, key)), user_id=USER_ID,
            source="gymapp", source_key=key, name_ru=name, muscle_group="Грудь" if key=="bar" else "Ноги",
            weight_type=kind, base_weight_kg=base, multiplier=mult, is_active=True, measure="strength",
            tonnage_mode="external_load", source_payload={}))
    client.tables["gym_exercises"].append(dict(id=str(uuid.uuid5(uuid.NAMESPACE_DNS, "treadmill")), user_id=USER_ID,
        source="gymapp", source_key="treadmill", name_ru="Беговая дорожка", muscle_group="Кардио",
        weight_type="Other", base_weight_kg=0, multiplier=1, is_active=True, measure="cardio",
        tonnage_mode="excluded", source_payload={}))
    store = supabase_store.SupabaseStore(client)
    supabase_store._default_store = store
    index.authenticate_request = lambda headers: SimpleNamespace(user_id=USER_ID)
    for i, key in enumerate(("bar", "hack")):
        store.save_set(USER_ID, {"exercise_id": key, "session_id": "fixture-newer", "set_group_id": key,
            "client_request_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "fixture-set-"+key)),
            "performed_at": "2026-10-16T10:00:00+03:00", "input_weight": 20 if key=="bar" else 30,
            "weight": 60 if key=="bar" else 70, "reps": 12, "rest": 2, "order": i+1, "location": "gym"})
    return client


CLIENT = reset()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        global CLIENT
        with LOCK:
            parsed = urlparse(self.path)
            if parsed.path == "/__reset" and self.command == "POST":
                CLIENT = reset()
                body, status = {"status": "reset"}, 200
            elif parsed.path == "/__state":
                body, status = copy.deepcopy(CLIENT.tables), 200
            else:
                length = int(self.headers.get("content-length", 0))
                event = {"httpMethod": self.command, "queryStringParameters": {k: v[0] for k,v in parse_qs(parsed.query).items()},
                         "headers": dict(self.headers), "body": self.rfile.read(length).decode() if length else ""}
                result = index.handler(event, None)
                status = result["statusCode"]
                body = json.loads(result["body"] or "{}")
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)


if __name__ == "__main__":
    print("Memory-only GymApp fixture: http://127.0.0.1:8766", flush=True)
    HTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
