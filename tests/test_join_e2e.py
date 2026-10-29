"""05_join.py end to end on a tiny synthetic dataset: label joins, industry -> function
overrides, side roles, and the credential (level / program / discipline) rules."""

import pytest

from conftest import read_rows, write_labels, write_parquet

T = dict  # title label
TITLE_LABELS = [
    ("Associate", T(fn="other", lvl="entry", std="Associate", stu=False, amb=True)),
    ("Partner", T(fn="consulting_strategy", lvl="executive", std="Partner", stu=False, amb=True)),
    ("Director", T(fn="executive_general_mgmt", lvl="director", std="Director", stu=False, amb=True)),
    ("Research Associate", T(fn="research_science", lvl="entry", std="Research Associate", stu=False, amb=True)),
    ("Software Engineer", T(fn="software_engineering", lvl="mid", std="Software Engineer", stu=False, amb=False)),
    ("Consultant", T(fn="consulting_strategy", lvl="mid", std="Consultant", stu=False, amb=False)),
    ("Volunteer", T(fn="social_community_services", lvl="unknown", std="Volunteer", stu=False, amb=False)),
    ("President", T(fn="executive_general_mgmt", lvl="executive", std="President", stu=True, amb=True)),
    ("Mentor Program Coordinator", T(fn="administration_support", lvl="entry", std="Program Coordinator",
                                     stu=False, amb=False)),
    ("Brd Mbr", T(fn="other", lvl="unknown", std="Board Member", stu=False, amb=False)),
    ("Volunteer Firefighter", T(fn="military_protective", lvl="mid", std="", stu=False, amb=False)),
    # Two items that normalise to the same key: the lower id wins.
    ("analyst", T(fn="data_analytics_ai", lvl="entry", std="Analyst", stu=False, amb=False)),
    ("Analyst ", T(fn="other", lvl="entry", std="Analyst", stu=False, amb=False)),
]
COMPANY_LABELS = [
    ("Big Bank", dict(ind="banking", parent="Big Bank Group")),
    ("Law LLP", dict(ind="legal_services", parent="Law LLP")),
    ("Ontario Ministry of Finance", dict(ind="government_public_sector", parent="Government of Ontario")),
    ("Deloitte", dict(ind="accounting_professional_services", parent="Deloitte")),
    ("Shopify", dict(ind="software_internet", parent="Shopify")),
    ("Queen's Debating Union", dict(ind="student_organization", parent="Queen's University")),
    ("Board Org", dict(ind="nonprofit_ngo", parent="Board Org")),
]
FIELD_LABELS = [(text, dict(prog=prog, disc=disc)) for text, prog, disc in [
    ("Finance", "Finance", "business_commerce"),
    ("Marketing", "Marketing", "business_commerce"),
    ("Business Administration and Management, General", "Business Administration", "business_commerce"),
    ("Business", "Business", "business_commerce"),
    ("Commerce", "Commerce", "business_commerce"),
    ("Law", "Law", "law"),
    ("Medicine", "Medicine", "health_medicine_nursing"),
    ("Economics", "Economics", "economics"),
    ("Psychology", "Psychology", "social_sciences"),
    ("Unknown", "Unknown", "other"),
    ("English Language and Literature", "English Language and Literature", "humanities"),
    ("Arts", "Arts", "humanities"),
]]

# (case / person id, title, company, expected fn)
FN_CASES = [
    ("amb_other_at_bank", "Associate", "Big Bank", "finance_investing"),
    ("amb_consulting_at_law_firm", "Partner", "Law LLP", "legal"),
    ("amb_exec_at_government", "Director", "Ontario Ministry of Finance", "public_policy_government"),
    ("amb_specific_guess_kept", "Research Associate", "Big Bank", "research_science"),
    ("not_amb_kept", "Software Engineer", "Big Bank", "software_engineering"),
    ("not_amb_generic_kept", "Consultant", "Law LLP", "consulting_strategy"),
    ("narrow_overrides_other", "Associate", "Deloitte", "accounting_audit_tax"),
    ("narrow_overrides_exec", "Director", "Deloitte", "accounting_audit_tax"),
    ("narrow_keeps_consulting", "Partner", "Deloitte", "consulting_strategy"),
    ("unmapped_industry_kept", "Associate", "Shopify", "other"),
    ("name_pattern_industry", "Partner", "Smith & Jones Barristers", "legal"),
    ("law_degree_unlabelled_firm", "Partner", "Smith Holdings", "legal"),
    ("no_law_degree_unlabelled_firm", "Partner", "Smith Holdings", "consulting_strategy"),
    ("law_degree_labelled_firm", "Partner", "Shopify", "consulting_strategy"),
    ("law_degree_no_company", "Partner", None, "legal"),
    ("unlabelled_title", "Zzz Unknown Title", "Big Bank", None),
    ("blank_title", None, "Big Bank", None),
    ("title_normalised", "  ANALYST\t", "Shopify", "data_analytics_ai"),
]
LAW_DEGREE_PEOPLE = {"law_degree_unlabelled_firm", "law_degree_labelled_firm", "law_degree_no_company"}

# (case / person id, title, company, expected side)
SIDE_CASES = [
    ("side_volunteer", "Volunteer", "Board Org", True),
    ("side_student_org", "President", "Queen's Debating Union", True),
    ("side_std_preferred_over_title", "Mentor Program Coordinator", "Shopify", False),
    ("side_from_std", "Brd Mbr", "Board Org", True),
    ("side_empty_std_uses_title", "Volunteer Firefighter", "Big Bank", True),
    ("side_unlabelled_title_uses_title", "Board Member, Somewhere", "Shopify", True),
    ("side_regular_job", "Software Engineer", "Big Bank", False),
]

# (case / person id, degree, field, level, program, disc, level_inferred)
CRED_CASES = [
    ("bcom_finance", "Bachelor of Commerce - BCom", "Finance", "bachelor", "Commerce", "business_commerce", False),
    ("bcom_marketing", "Bachelor of Commerce - BCom", "Marketing", "bachelor", "Commerce", "business_commerce", False),
    ("mba", "Master of Business Administration - MBA", "Business Administration and Management, General",
     "mba", "MBA", "business_commerce", False),
    # A master's in business is renamed to the MBA program but keeps level 'master' (see report).
    ("master_in_business", "Master's degree", "Business", "mba", "MBA", "business_commerce", False),
    ("jd", "Juris Doctor - JD", "Law", "jd", "Law", "law", False),
    ("llb_no_field", "LLB", None, "jd", "Law", "law", False),
    ("llm", "Master of Laws - LLM", "Law", "master", "Law", "law", False),
    ("md", "Doctor of Medicine - MD", "Medicine", "md", "Medicine", "health_medicine_nursing", False),
    ("commerce_no_degree", None, "Commerce", "bachelor", "Commerce", "business_commerce", True),
    ("economics_in_degree_box", "Economics", None, "unknown", "Economics", "economics", False),
    ("basc_no_field", "Bachelor of Applied Science - BASc", None, "bachelor", "Engineering (unspecified)",
     "engineering", False),
    ("bed_unknown_field", "Bachelor of Education (B.Ed.)", "Unknown", "bachelor", "Education", "education", False),
    ("english_merged", "Bachelor of Arts - BA", "English Language and Literature", "bachelor", "English",
     "humanities", False),
    ("arts_merged", "Bachelor of Arts - BA", "Arts", "bachelor", "Arts (general)", "humanities", False),
    ("certificate", "Certificate in Business", "Business", "certificate", "Business", "business_commerce", False),
    ("psych_inferred_at_80pct", None, "Psychology", "bachelor", "Psychology", "social_sciences", True),
    ("no_degree_no_field", None, None, "unknown", None, None, False),
]
# Entries that set each program's usual level: Economics is 3/4 bachelor (< 0.8, no inference),
# Psychology 4/5 (= 0.8, inferred).
SUPPORT_EDU = ([("eco_ba", "Bachelor of Arts - BA", "Economics")] * 3 + [("eco_ma", "Master of Arts - MA", "Economics")]
               + [("psy_ba", "Bachelor of Arts - BA", "Psychology")] * 4
               + [("psy_msc", "Master of Science - MSc", "Psychology")])


@pytest.fixture(scope="module")
def joined(tmp_path_factory, join, ingest):
    root = tmp_path_factory.mktemp("join")
    proc, labels, out = root / "processed", root / "labels", root / "derived"
    positions = [{"person_id": pid, "exp_idx": 0, "pos_idx": 0, "title": title, "company": company,
                  "start_ym": 201501, "end_ym": 201812}
                 for pid, title, company, *_ in FN_CASES + SIDE_CASES]
    education = [{"person_id": pid, "idx": 1, "school": "University of Toronto", "is_queens": False,
                  "degree": "Juris Doctor", "field": "Law", "start_year": 2010, "end_year": 2013}
                 for pid in LAW_DEGREE_PEOPLE]
    education += [{"person_id": pid, "idx": 0, "school": "Queen's University", "is_queens": True,
                   "degree": degree, "field": field, "start_year": 2010, "end_year": 2014}
                  for pid, degree, field, *_ in CRED_CASES]
    education += [{"person_id": f"{pid}_{i}", "idx": 0, "school": "Queen's University", "is_queens": True,
                   "degree": degree, "field": field, "start_year": 2010, "end_year": 2014}
                  for i, (pid, degree, field) in enumerate(SUPPORT_EDU)]
    write_parquet(proc / "positions.parquet", positions, ingest.SCHEMAS["positions"])
    write_parquet(proc / "education.parquet", education, ingest.SCHEMAS["education"])
    write_labels(labels, "titles", TITLE_LABELS)
    write_labels(labels, "companies", COMPANY_LABELS)
    write_labels(labels, "fields", FIELD_LABELS)
    join.main(proc=proc, labels=labels, out=out, report=False)
    return {"roles": {r["person_id"]: r for r in read_rows(out / "roles.parquet")},
            "credentials": {r["person_id"]: r for r in read_rows(out / "credentials.parquet")},
            "out": out}


@pytest.mark.parametrize("pid, title, company, fn", FN_CASES, ids=[c[0] for c in FN_CASES])
def test_function_after_overrides(joined, pid, title, company, fn):
    assert joined["roles"][pid]["fn"] == fn


def test_title_label_columns_carried(joined):
    role = joined["roles"]["amb_other_at_bank"]
    assert (role["fn_title"], role["lvl"], role["std"], role["stu"], role["amb"]) == \
        ("other", "entry", "Associate", False, True)
    assert (role["ind"], role["parent"], role["ind_from_name"]) == ("banking", "Big Bank Group", False)


@pytest.mark.parametrize("pid, ind, from_name", [
    ("name_pattern_industry", "legal_services", True),     # unlabelled employer, name says law firm
    ("law_degree_unlabelled_firm", None, False),           # unlabelled, no pattern
    ("law_degree_no_company", None, False),
    ("amb_other_at_bank", "banking", False),               # labelled employer
], ids=lambda x: str(x))
def test_industry_from_name(joined, pid, ind, from_name):
    role = joined["roles"][pid]
    assert (role["ind"], role["ind_from_name"]) == (ind, from_name)


@pytest.mark.parametrize("pid, title, company, side", SIDE_CASES, ids=[c[0] for c in SIDE_CASES])
def test_side_flag(joined, pid, title, company, side):
    assert joined["roles"][pid]["side"] is side


def test_every_position_kept_once(joined):
    assert set(joined["roles"]) == {c[0] for c in FN_CASES + SIDE_CASES}


def test_empty_std_becomes_null(joined):
    assert joined["roles"]["side_empty_std_uses_title"]["std"] is None


@pytest.mark.parametrize("pid, degree, field, level, program, disc, inferred", CRED_CASES,
                         ids=[c[0] for c in CRED_CASES])
def test_credentials(joined, pid, degree, field, level, program, disc, inferred):
    cred = joined["credentials"][pid]
    assert (cred["level"], cred["program"], cred["disc"]) == (level, program, disc)
    # level_inferred is NULL (not false) when an unknown entry's program has no usual level.
    assert bool(cred["level_inferred"]) is inferred


def test_credentials_are_queens_only(joined):
    assert not LAW_DEGREE_PEOPLE & set(joined["credentials"])
    assert len(read_rows(joined["out"] / "credentials.parquet")) == len(CRED_CASES) + len(SUPPORT_EDU)


def test_credentials_columns(joined):
    cred = joined["credentials"]["bcom_finance"]
    assert list(cred) == ["person_id", "idx", "degree", "field", "start_year", "end_year", "program", "disc",
                          "level", "level_inferred"]


def test_report_runs(join, joined, tmp_path, capsys, ingest):
    """The default report prints summary tables (aggregates only)."""
    proc = joined["out"].parent / "processed"
    join.main(proc=proc, labels=joined["out"].parent / "labels", out=tmp_path)
    printed = capsys.readouterr().out
    assert "side_roles" in printed and "with_program" in printed
