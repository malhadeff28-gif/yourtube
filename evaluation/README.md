# Local ranking evaluation

`node evaluation/relevance.js` runs four illustrative synthetic examples. To use a separately prepared local fixture, explicitly provide its path:

```sh
node evaluation/relevance.js --fixture /path/to/labeled.json
```

The program reads only that file; it does not read chats or feeds automatically, call a provider, or save results. Its output contains aggregate counts and metrics, not the path, queries, titles, channels, or IDs. Use only data you are authorized to read and label. An independently labeled and representative holdout is needed to interpret results; this tool does not validate the labels or demonstrate real-world recommendation quality.

The UTF-8 JSON file must be a non-empty array of cases. Each case has exactly a non-empty `query`, a non-empty `candidates` array, and an explicit `relevant` array. Each candidate has exactly non-empty `id`, `title`, and `channel` strings. Candidate IDs must be unique within each case; relevant IDs must be unique and refer to candidates in that case. Use `"relevant": []` when none is relevant. For example, these are synthetic labels:

```json
[
  {
    "query": "synthetic example",
    "candidates": [
      {"id": "a", "title": "An example", "channel": "Demo"},
      {"id": "b", "title": "Another topic", "channel": "Demo"}
    ],
    "relevant": ["a"]
  }
]
```

The limit is 2 MiB per file, 1,000 cases, 100 candidates per case, 2,000 UTF-16 code units for each query/title/channel, and 128 for each ID. JSON objects cannot contain duplicate names, including escaped-equivalent names; nesting is limited to 32 levels. Invalid, oversized, empty, or unreadable input is rejected without printing its contents or path. This is a fixed-candidate ranking comparison: it reports the case count, number with and without relevant candidates, Hit@1, and mean reciprocal rank (MRR) for provider order and the local lexical rerank. Both metrics use **all cases** as the denominator; a case with no relevant candidate contributes zero. It does not measure provider retrieval, actual Live delivery, video content quality, or relevance for a user's real work.
