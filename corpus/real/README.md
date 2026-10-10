# Real Document Corpus Privacy & Benchmark Policy

## Privacy Policy
This directory (`corpus/real/`) is designated exclusively for locally evaluated real-world private test fixtures.

To protect confidentiality and intellectual property:
1. **Zero Real User Documents in Public Git**: Real proprietary documents, scanned exams, internal technical notes, and identifiable PDFs are NEVER committed or pushed to public repositories.
2. **Local Benchmark Template**: Use `manifest.template.json` to register local ground-truth files for private quality benchmarking.
3. **Automated Validation**: Run `npm run corpus:add-real` to validate a local entry against the schema without publishing files.
