# Notebook and item set samples

`client-item-set.json` is a manually specified synthetic interchange expectation. It contains only item-set fields, numeric champion/map associations and string item IDs. It is not captured from a Riot/Tencent client and does not establish current client import compatibility. The item-set collection served by the dev harness is also synthetic; unknown root and set fields are deliberately retained for merge assertions.

Notebook, revision, import, practice, baseline and batch cases are constructed explicitly in `crates/riftmind-core/tests/champion_notebooks.rs`; the underlying review inputs retain the provenance recorded in `../review/README.md`. Quantile expectations are manual: `[10,20,30,40,50]` has Q1 20, median 30, Q3 40; the most recent 20 values of `[10,20,…,250]` have Q1 107.5, median 155, Q3 202.5 using type 7 interpolation. These expectations do not come from the current implementation.
