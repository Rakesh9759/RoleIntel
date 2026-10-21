import re

from roleintel.schemas import JobParseRequest, JobParseResult

LABELS = {
    "company": "company",
    "company name": "company",
    "title": "title",
    "job title": "title",
    "job id": "requisition_id",
    "requisition id": "requisition_id",
    "location": "location",
    "technologies": "technologies",
    "required technologies": "technologies",
    "experience requirements": "experience_requirements",
    "seniority": "seniority",
    "department": "department",
    "team": "department",
}


def normalize_description(submission: JobParseRequest) -> JobParseResult:
    text = submission.description.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[^\S\n]+", " ", line).strip() for line in text.split("\n")]
    description = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    candidates: dict[str, list[str]] = {}
    for line in description.split("\n"):
        label, separator, value = line.partition(":")
        field = LABELS.get(label.strip().casefold())
        if separator and field is not None:
            candidates.setdefault(field, []).append(value.strip())

    fields: dict[str, str | list[str] | None] = {}
    warnings: list[str] = []
    for field, values in candidates.items():
        unique = list(dict.fromkeys(values))
        if len(unique) != 1 or not unique[0]:
            warnings.append(f"{field}: blank or conflicting labels; review manually.")
            continue
        value = unique[0]
        if field == "technologies":
            items = list(dict.fromkeys(item.strip() for item in re.split("[,;]", value)))
            if len(items) > 100 or any(not item or len(item) > 1000 for item in items):
                warnings.append("technologies: invalid list; review manually.")
            else:
                fields[field] = items
        elif len(value) > (100_000 if field == "experience_requirements" else 1000):
            warnings.append(f"{field}: value exceeds the field limit; review manually.")
        else:
            fields[field] = value

    return JobParseResult.model_validate(
        {**fields, "description": description, "warnings": warnings}
    )
