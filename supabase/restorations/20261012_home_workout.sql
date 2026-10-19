-- Generated restoration; review and approve before applying to HealthOS.
-- No network is used by the generator. All writes below form ONE transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.gym_exercises, public.gym_workout_sessions, public.gym_set_groups,
  public.gym_sets, public.gym_cardio_segments, public.episodes in share row exclusive mode;
create temp table restore_plan on commit drop as select '{
  "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
  "session": {
    "id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
    "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
    "workout_date": "2026-10-12",
    "started_at": null,
    "ended_at": null,
    "source": "gymapp",
    "source_record_id": "restore-home-2026-10-12-v1",
    "location": "home",
    "duration_minutes": 60,
    "duration_is_approximate": true,
    "session_note": "Домашняя тренировка восстановлена по фактически выполненным подходам. Вес гантели указан для одной руки; концентрированный подъём — 12 повторений каждой рукой в каждом из четырёх подходов.",
    "source_payload": {
      "restoration": "restore-home-2026-10-12-v1",
      "client_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff"
    }
  },
  "exercises": [
    {
      "slot": 1,
      "key": "6d50c565-e5f6-4895-bdf5-a2562ba68dd25",
      "id": "a50727e2-c122-5018-85f4-d2e3afd2a53f",
      "name": "Махи в стороны (стоя)",
      "muscle": "Плечи",
      "kind": "Dumbbell",
      "mult": 2,
      "per_side": false
    },
    {
      "slot": 2,
      "key": "adbad182-27f2-4bdd-8b77-0df259d789f5",
      "id": "ca9380d2-ca43-5c53-a102-926339a31dd4",
      "name": "Протяжка гири",
      "muscle": "Плечи",
      "kind": "Other",
      "mult": 1,
      "per_side": false
    },
    {
      "slot": 3,
      "key": "4267ab6c-26e2-4741-811a-de40a23f473e",
      "id": "8e331bf0-fff1-52cd-b10e-52d85020888f",
      "name": "Сгибание рук с гантелями стоя",
      "muscle": "Бицепс",
      "kind": "Dumbbell",
      "mult": 2,
      "per_side": false
    },
    {
      "slot": 4,
      "key": null,
      "id": "2d18aa03-7abd-5c92-87b9-ff7b428d6f85",
      "name": "Разгибание рук с гантелями на трицепс в наклоне",
      "muscle": "Трицепс",
      "kind": "Dumbbell",
      "mult": 2,
      "per_side": false
    },
    {
      "slot": 5,
      "key": null,
      "id": "3fb7157d-1094-5d51-ab00-2312b543b127",
      "name": "Концентрированный подъём на бицепс",
      "muscle": "Бицепс",
      "kind": "Dumbbell",
      "mult": 2,
      "per_side": true
    }
  ],
  "groups": [
    {
      "id": "d811d645-2270-5a9e-9c6b-9f7ba968627a",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "position": 1,
      "group_type": "single",
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:group:1",
      "legacy_group_id": "d811d645-2270-5a9e-9c6b-9f7ba968627a",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1"
      }
    },
    {
      "id": "67bd00d5-0963-534f-b228-eb61417908f4",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "position": 6,
      "group_type": "single",
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:group:2",
      "legacy_group_id": "67bd00d5-0963-534f-b228-eb61417908f4",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1"
      }
    },
    {
      "id": "e49099ef-d68d-588f-ac75-501a7dcffaf6",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "position": 10,
      "group_type": "single",
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:group:3",
      "legacy_group_id": "e49099ef-d68d-588f-ac75-501a7dcffaf6",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1"
      }
    },
    {
      "id": "5ef3aa45-265e-59ad-8eeb-4d1bc77bcae0",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "position": 14,
      "group_type": "single",
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:group:4",
      "legacy_group_id": "5ef3aa45-265e-59ad-8eeb-4d1bc77bcae0",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1"
      }
    },
    {
      "id": "a943d0f4-302b-5fc6-ac7e-c40f3913325e",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "position": 18,
      "group_type": "single",
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:group:5",
      "legacy_group_id": "a943d0f4-302b-5fc6-ac7e-c40f3913325e",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1"
      }
    }
  ],
  "sets": [
    {
      "id": "5507a7cf-ef75-5fa3-b83d-64e3d60d7011",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "d811d645-2270-5a9e-9c6b-9f7ba968627a",
      "exercise_slot": 1,
      "performed_at": null,
      "position": 1,
      "input_weight_kg": 2,
      "total_weight_kg": 4,
      "reps": 20,
      "rest_seconds": 90,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:1",
      "client_request_id": "d734a83c-fa23-5c3e-b6c9-42d942a93984",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "db56bb66-e5c1-5cc0-ba5e-a332389d5ea2",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "d811d645-2270-5a9e-9c6b-9f7ba968627a",
      "exercise_slot": 1,
      "performed_at": null,
      "position": 2,
      "input_weight_kg": 2,
      "total_weight_kg": 4,
      "reps": 20,
      "rest_seconds": 90,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:2",
      "client_request_id": "3f20e8b6-7ea8-558b-bdd6-86229e417a35",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "82f544c8-0bb1-5ddd-a6e9-d6181c443640",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "d811d645-2270-5a9e-9c6b-9f7ba968627a",
      "exercise_slot": 1,
      "performed_at": null,
      "position": 3,
      "input_weight_kg": 4,
      "total_weight_kg": 8,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:3",
      "client_request_id": "f583d384-1f52-5c97-96fd-7ab3154bfb70",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "bf5e2d97-644d-55a8-a4c3-ab3ae4efbf35",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "d811d645-2270-5a9e-9c6b-9f7ba968627a",
      "exercise_slot": 1,
      "performed_at": null,
      "position": 4,
      "input_weight_kg": 4,
      "total_weight_kg": 8,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:4",
      "client_request_id": "5c6c8527-87dc-5bac-ac9c-003f16afb175",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "ed42e833-3ace-5e19-bfa9-a2e7ecf7ccb8",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "d811d645-2270-5a9e-9c6b-9f7ba968627a",
      "exercise_slot": 1,
      "performed_at": null,
      "position": 5,
      "input_weight_kg": 4,
      "total_weight_kg": 8,
      "reps": 15,
      "rest_seconds": 0,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:5",
      "client_request_id": "9bbc335d-fadd-58bb-916a-d27c38665177",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "76061fcc-5685-544a-8b26-41d9eabfdae6",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "67bd00d5-0963-534f-b228-eb61417908f4",
      "exercise_slot": 2,
      "performed_at": null,
      "position": 6,
      "input_weight_kg": 24,
      "total_weight_kg": 24,
      "reps": 15,
      "rest_seconds": 90,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:6",
      "client_request_id": "24c6e468-a6d1-5d4a-bf44-a439f82af1ac",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Other",
          "mult": 1,
          "base": 0
        }
      }
    },
    {
      "id": "352804d6-7439-5a5e-a406-20e6d9cba50d",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "67bd00d5-0963-534f-b228-eb61417908f4",
      "exercise_slot": 2,
      "performed_at": null,
      "position": 7,
      "input_weight_kg": 24,
      "total_weight_kg": 24,
      "reps": 15,
      "rest_seconds": 90,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:7",
      "client_request_id": "fa658350-5a77-584e-9d34-8ea240d2b2be",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Other",
          "mult": 1,
          "base": 0
        }
      }
    },
    {
      "id": "6096688c-994d-5237-95c1-fa69c1574fc8",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "67bd00d5-0963-534f-b228-eb61417908f4",
      "exercise_slot": 2,
      "performed_at": null,
      "position": 8,
      "input_weight_kg": 24,
      "total_weight_kg": 24,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:8",
      "client_request_id": "e1f5315d-5145-5315-a786-0c4c1e7cacbf",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Other",
          "mult": 1,
          "base": 0
        }
      }
    },
    {
      "id": "0facdb36-eea2-5718-95fd-d92510dc03ce",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "67bd00d5-0963-534f-b228-eb61417908f4",
      "exercise_slot": 2,
      "performed_at": null,
      "position": 9,
      "input_weight_kg": 24,
      "total_weight_kg": 24,
      "reps": 15,
      "rest_seconds": 0,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:9",
      "client_request_id": "df1ae694-4d85-5815-b67a-f55f7bc425f7",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Other",
          "mult": 1,
          "base": 0
        }
      }
    },
    {
      "id": "51c24746-b8ac-5955-aa02-aae97dc6f767",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "e49099ef-d68d-588f-ac75-501a7dcffaf6",
      "exercise_slot": 3,
      "performed_at": null,
      "position": 10,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:10",
      "client_request_id": "60b96f66-85d4-53dd-b03e-2ff29da9421e",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "8f49c8a2-fc9e-5001-9a06-1237da7a28c6",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "e49099ef-d68d-588f-ac75-501a7dcffaf6",
      "exercise_slot": 3,
      "performed_at": null,
      "position": 11,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:11",
      "client_request_id": "b12c1628-c2e5-5c1d-8910-4ca7249664c4",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "6ce11785-11d8-513f-8b5c-1e40322365c9",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "e49099ef-d68d-588f-ac75-501a7dcffaf6",
      "exercise_slot": 3,
      "performed_at": null,
      "position": 12,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:12",
      "client_request_id": "b2894dd6-6304-5258-857d-d2a8c0438335",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "40e77cea-0e1a-5068-9d1f-f069e08915a9",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "e49099ef-d68d-588f-ac75-501a7dcffaf6",
      "exercise_slot": 3,
      "performed_at": null,
      "position": 13,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 15,
      "rest_seconds": 0,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:13",
      "client_request_id": "35b7c67d-bc6f-5191-a3ac-2ee7a97d6a13",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "0d187ffb-8b92-5a32-924b-d7e36f5191a4",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "5ef3aa45-265e-59ad-8eeb-4d1bc77bcae0",
      "exercise_slot": 4,
      "performed_at": null,
      "position": 14,
      "input_weight_kg": 4,
      "total_weight_kg": 8,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:14",
      "client_request_id": "8f119358-f19b-51e6-b553-db2f8b156418",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "1dddb88b-35d7-55e0-9771-2f3db3103ff6",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "5ef3aa45-265e-59ad-8eeb-4d1bc77bcae0",
      "exercise_slot": 4,
      "performed_at": null,
      "position": 15,
      "input_weight_kg": 4,
      "total_weight_kg": 8,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:15",
      "client_request_id": "26a9203f-ee88-5712-9acc-2928d80d0ecf",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "890cdb0f-4aa7-5a1a-a74c-eb5c590e5431",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "5ef3aa45-265e-59ad-8eeb-4d1bc77bcae0",
      "exercise_slot": 4,
      "performed_at": null,
      "position": 16,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 15,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:16",
      "client_request_id": "aa7ce946-f328-5ef9-9606-d7ca9fd024ef",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "33764474-2e6f-5470-8e57-8cd3fe2261b3",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "5ef3aa45-265e-59ad-8eeb-4d1bc77bcae0",
      "exercise_slot": 4,
      "performed_at": null,
      "position": 17,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 15,
      "rest_seconds": 0,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:17",
      "client_request_id": "81cc6b08-f8e1-5eec-a5c6-4caa2e12eba9",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0
        }
      }
    },
    {
      "id": "df4fb939-f1da-590f-9424-163dc33160d0",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "a943d0f4-302b-5fc6-ac7e-c40f3913325e",
      "exercise_slot": 5,
      "performed_at": null,
      "position": 18,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 12,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": "Первый подход лёгкий.",
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:18",
      "client_request_id": "7f644026-5ff8-5352-97b6-cef2f09d3fc0",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0,
          "perSide": true
        }
      }
    },
    {
      "id": "71ce83da-7dc9-5a87-bc94-c1e606c15a36",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "a943d0f4-302b-5fc6-ac7e-c40f3913325e",
      "exercise_slot": 5,
      "performed_at": null,
      "position": 19,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 12,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": null,
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:19",
      "client_request_id": "0a539d29-a175-5a71-9008-269a0dbaed02",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0,
          "perSide": true
        }
      }
    },
    {
      "id": "dffd5891-fa79-57d7-873e-a3c3dfddaa55",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "a943d0f4-302b-5fc6-ac7e-c40f3913325e",
      "exercise_slot": 5,
      "performed_at": null,
      "position": 20,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 12,
      "rest_seconds": 120,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": "Подходящая нагрузка.",
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:20",
      "client_request_id": "16725b87-7edb-5ceb-88cc-4c5cfe80794c",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0,
          "perSide": true
        }
      }
    },
    {
      "id": "00c01965-e798-5403-af79-e35f0616b260",
      "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
      "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "set_group_id": "a943d0f4-302b-5fc6-ac7e-c40f3913325e",
      "exercise_slot": 5,
      "performed_at": null,
      "position": 21,
      "input_weight_kg": 8,
      "total_weight_kg": 16,
      "reps": 12,
      "rest_seconds": 0,
      "set_type": "working",
      "rpe": null,
      "rir": null,
      "note": "Подходящая нагрузка.",
      "include_in_tonnage": true,
      "source": "gymapp",
      "source_record_id": "restore-home-2026-10-12-v1:set:21",
      "client_request_id": "a6510245-d947-5b96-a830-eaf133eb4721",
      "legacy_session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff",
      "source_payload": {
        "restoration": "restore-home-2026-10-12-v1",
        "load": {
          "v": 1,
          "type": "Dumbbell",
          "mult": 2,
          "base": 0,
          "perSide": true
        }
      }
    }
  ],
  "reflection": {
    "id": -2293752285585778215,
    "user_id": "270665a4-6de1-42f6-9799-4d5ad054202b",
    "type": "workout_note",
    "start": "2026-10-12",
    "title": "Домашняя тренировка 12.10.2026",
    "note": "Протяжка гири: тяжеловато, небольшая раскачка, первое выполнение после долгого перерыва. Бицепс стоя: тяжеловато. Трицепс: 4 кг слишком легко, на 8 кг оставался запас. Концентрированный бицепс: первый подход лёгкий, третий и четвёртый — подходящая нагрузка.",
    "source": "manual",
    "metadata": {
      "ingest": "gymapp_restoration_v1",
      "restoration": "restore-home-2026-10-12-v1",
      "workout_reflection": {
        "session_id": "aad8ddfc-925c-58f7-b1eb-35108e9ee9ff"
      }
    }
  }
}'::jsonb as data;
-- Assert that unrelated training rows remain byte-for-byte identical.
create temp table restore_before on commit drop as
select 'sessions' as kind, id::text, to_jsonb(t) as data from public.gym_workout_sessions t
union all select 'groups',id::text,to_jsonb(t) from public.gym_set_groups t
union all select 'sets',id::text,to_jsonb(t) from public.gym_sets t
union all select 'cardio',id::text,to_jsonb(t) from public.gym_cardio_segments t;
do $restore$
declare
  p jsonb := (select data from restore_plan);
  owner_id uuid := (p->>'user_id')::uuid;
  sid uuid := (p->'session'->>'id')::uuid;
  e jsonb; row_data jsonb; expected jsonb; actual jsonb; eid uuid; n integer;
  exercise_ids uuid[] := '{}';
begin
  if not exists(select 1 from auth.users where id=owner_id) then
    raise exception 'Reviewed owner missing';
  end if;
  -- This task restores ONE missing session. Never merge a different session by date.
  if exists(select 1 from public.gym_workout_sessions where user_id=owner_id
            and workout_date='2026-10-12' and id<>sid) then
    raise exception 'Another session exists on 2026-10-12; manual review required';
  end if;
  for e in select value from jsonb_array_elements(p->'exercises') loop
    if e->>'key' is not null then
      select count(*), (array_agg(id))[1] into n,eid from public.gym_exercises
        where user_id=owner_id and (id::text=e->>'key' or source_key=e->>'key');
    else
      -- Include known spelling/name variants and aliases; ambiguous matches abort.
      select count(distinct ge.id), (array_agg(distinct ge.id))[1] into n,eid
      from public.gym_exercises ge left join public.gym_exercise_aliases a
        on a.user_id=ge.user_id and a.exercise_id=ge.id
      where ge.user_id=owner_id and (
        lower(replace(ge.name_ru,'ё','е'))=lower(replace(e->>'name','ё','е'))
        or lower(replace(a.alias_value,'ё','е'))=lower(replace(e->>'name','ё','е'))
        or ((e->>'slot')::int=4 and ge.name_ru ilike '%разгибан%'
            and ge.name_ru ilike '%наклон%' and ge.weight_type='Dumbbell')
        or ((e->>'slot')::int=5 and ge.name_ru ilike '%концентр%'
            and (ge.name_ru ilike '%бицеп%' or ge.name_ru ilike '%сгибан%')));
    end if;
    if n>1 or (n=0 and e->>'key' is not null) then
      raise exception 'Missing or ambiguous exercise: %',e->>'name';
    end if;
    if n=0 then
      eid := (e->>'id')::uuid;
      insert into public.gym_exercises(id,user_id,source,source_key,name_ru,muscle_group,
        weight_type,base_weight_kg,multiplier,tonnage_mode,source_payload,description)
      values(eid,owner_id,'gymapp',eid::text,e->>'name',e->>'muscle',e->>'kind',0,
        (e->>'mult')::numeric,'external_load',jsonb_build_object('restoration',p->'session'->>'source_record_id',
        'reps_per_side',(e->>'per_side')::boolean),
        case when (e->>'per_side')::boolean then
        'Одностороннее выполнение: один подход включает обе руки. Повторения указываются на каждую руку; вес — одной гантели. Множитель 2 учитывает обе руки в тоннаже.'
        else 'Вес одной гантели; выполнение двумя гантелями.' end);
    end if;
    if (e->>'slot')::int=2 then
      -- Catalog correction ONLY; historical total_weight/tonnage stays intact.
      update public.gym_exercises set weight_type='Other',base_weight_kg=0,multiplier=1
        where user_id=owner_id and id=eid and
        (weight_type<>'Other' or base_weight_kg<>0 or multiplier<>1);
    end if;
    if not exists(select 1 from public.gym_exercises where id=eid and user_id=owner_id
      and is_active and weight_type=e->>'kind' and base_weight_kg=0
      and multiplier=(e->>'mult')::numeric and tonnage_mode='external_load'
      and ((e->>'slot')::int<>5 or source_payload @> '{"reps_per_side":true}')) then
      raise exception 'Exercise rules differ; review instead of overwriting: %',e->>'name';
    end if;
    exercise_ids := array_append(exercise_ids,eid);
  end loop;
  -- Insert-only; a retry must match, never overwrite manual changes.
  expected := p->'session';
  insert into public.gym_workout_sessions
    (id,user_id,workout_date,started_at,ended_at,source,source_record_id,location,
     duration_minutes,duration_is_approximate,session_note,source_payload)
  select id,user_id,workout_date,started_at,ended_at,source,source_record_id,location,
    duration_minutes,duration_is_approximate,session_note,source_payload
  from jsonb_populate_record(null::public.gym_workout_sessions,expected)
  on conflict do nothing;
  select to_jsonb(t) into actual from public.gym_workout_sessions t where id=sid and user_id=owner_id;
  if actual is null or not actual @> expected then raise exception 'Session conflict'; end if;
  for expected in select value from jsonb_array_elements(p->'groups') loop
    insert into public.gym_set_groups(id,user_id,session_id,position,group_type,source,
      source_record_id,legacy_group_id,source_payload)
    select id,user_id,session_id,position,group_type,source,source_record_id,legacy_group_id,source_payload
      from jsonb_populate_record(null::public.gym_set_groups,expected) on conflict do nothing;
    select to_jsonb(t) into actual from public.gym_set_groups t where id=(expected->>'id')::uuid and user_id=owner_id;
    if actual is null or not actual @> expected then raise exception 'Group conflict'; end if;
  end loop;
  for row_data in select value from jsonb_array_elements(p->'sets') loop
    expected := (row_data - 'exercise_slot') || jsonb_build_object('exercise_id',exercise_ids[(row_data->>'exercise_slot')::int]);
    insert into public.gym_sets(id,user_id,session_id,set_group_id,exercise_id,performed_at,position,
      input_weight_kg,total_weight_kg,reps,rest_seconds,set_type,rpe,rir,note,include_in_tonnage,
      source,source_record_id,client_request_id,legacy_session_id,source_payload)
    select id,user_id,session_id,set_group_id,exercise_id,performed_at,position,
      input_weight_kg,total_weight_kg,reps,rest_seconds,set_type,rpe,rir,note,include_in_tonnage,
      source,source_record_id,client_request_id,legacy_session_id,source_payload
    from jsonb_populate_record(null::public.gym_sets,expected) on conflict do nothing;
    select to_jsonb(t) into actual from public.gym_sets t where id=(expected->>'id')::uuid and user_id=owner_id;
    if actual is null or not actual @> expected then raise exception 'Set conflict'; end if;
  end loop;
  expected := p->'reflection';
  insert into public.episodes(id,user_id,type,start,title,note,source,metadata)
    overriding system value
    select id,user_id,type,start,title,note,source,metadata
    from jsonb_populate_record(null::public.episodes,expected) on conflict do nothing;
  select to_jsonb(t) into actual from public.episodes t where id=(expected->>'id')::bigint and user_id=owner_id;
  if actual is null or not actual @> expected then raise exception 'Reflection conflict'; end if;
  if (select count(*) from public.gym_sets where user_id=owner_id and session_id=sid)<>21
    or (select count(distinct exercise_id) from public.gym_sets where user_id=owner_id and session_id=sid)<>5
    or (select sum(tonnage_kg) from public.gym_sets where user_id=owner_id and session_id=sid)<>4408
    or exists(select 1 from public.gym_cardio_segments where user_id=owner_id and session_id=sid) then
    raise exception 'Restoration totals differ';
  end if;
  if exists(select 1 from restore_before b left join (
    select 'sessions' as kind,id::text,to_jsonb(t) as data from public.gym_workout_sessions t
    union all select 'groups',id::text,to_jsonb(t) from public.gym_set_groups t
    union all select 'sets',id::text,to_jsonb(t) from public.gym_sets t
    union all select 'cardio',id::text,to_jsonb(t) from public.gym_cardio_segments t
  ) a using(kind,id) where a.data is distinct from b.data) then
    raise exception 'An existing training record changed';
  end if;
end $restore$;
select session_id,date,exercise_count,total_sets,total_volume_kg,data->>'location' as location,
  data->>'duration_minutes' as duration_minutes
from public.gym_workout_projection where session_id=((select data from restore_plan)->'session'->>'id')::uuid;
commit;
