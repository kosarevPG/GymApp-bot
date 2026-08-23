# GymApp branch merge order

The Supabase staging PR is stacked on work that is not yet in `main`:

| Branch | Purpose | Merge target |
| --- | --- | --- |
| `codex/v2-offline-yandex-sheets` | frontend/offline queue and current Yandex path | `main` |
| `codex/gymapp-supabase-staging` | secure Supabase backend and staging gates | initially the branch above, finally `main` |

Use this order:

1. Open and review a PR from `codex/v2-offline-yandex-sheets` to `main` if one
   does not already exist. Keep the Supabase PR draft and based on that branch.
2. Merge the base PR into `main`. Do not delete the base branch before the
   stacked PR has been retargeted.
3. Update the stacked branch and retarget PR #1:

   ```powershell
   git switch codex/gymapp-supabase-staging
   git fetch origin
   git merge origin/main
   git push origin codex/gymapp-supabase-staging
   gh pr edit 1 --base main
   ```

4. Confirm that PR #1 now shows only the Supabase/auth/staging delta. Rerun all
   required checks and attach the isolated staging evidence.
5. Keep PR #1 draft until the E2E staging ledger passes. Then mark it ready,
   review, and merge it to `main`.

Do not squash or rebase the stacked PR before the base PR is merged unless the
reviewer deliberately wants rewritten history. The merge-and-retarget sequence
keeps the already-reviewed base commits attributable and minimizes accidental
loss of offline queue work.
