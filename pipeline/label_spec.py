"""
label_spec.py
-------------
Taxonomies, prompts and JSON schemas for the three LLM labelling tasks.
Kept separate from 04_label.py so the spec can be reviewed (and versioned) on its own.

Each task labels *distinct strings*, not people: a title like "Software Engineer"
is labelled once and the label is joined back onto every role that uses it.
"""

FUNCTIONS = [
    "software_engineering",      # SWE, devops, QA, web/mobile dev
    "data_analytics_ai",         # data science, analytics, BI, ML
    "it_infrastructure",         # IT support, sysadmin, security, networks
    "engineering",               # mech/civil/elec/chem/mining eng practice, EIT, P.Eng work
    "product_management",
    "design_ux",
    "research_science",          # scientists, lab/research staff outside a teaching role
    "academia",                  # professors, lecturers, postdocs, deans
    "teaching_k12",              # teachers, ECE, principals, tutors
    "healthcare_clinical",       # physicians, nurses, therapists, pharmacists, residents
    "finance_investing",         # banking, capital markets, PE/VC, asset mgmt, corporate finance
    "accounting_audit_tax",
    "consulting_strategy",
    "sales_business_development",
    "marketing_communications",  # incl. PR, content, social
    "operations_supply_chain",   # ops, logistics, procurement, project/program mgmt
    "hr_people",
    "legal",                     # lawyers, paralegals, articling students, clerks
    "public_policy_government",  # policy analysts, public servants, politicians
    "social_community_services", # social work, counselling, nonprofit programs, clergy
    "arts_media_creative",       # writers, journalists, artists, musicians, film
    "entrepreneurship_founder",  # founder / co-founder / owner of own venture
    "executive_general_mgmt",    # CEO, president, GM, COO when no narrower function fits
    "administration_support",    # admin, reception, executive assistants, customer service
    "trades_retail_service",     # retail, hospitality, trades, camp counsellor, lifeguard
    "military_protective",       # armed forces, police, fire, security
    "athletics_sports",
    "other",
]

SENIORITY = [
    "intern",     # intern, co-op, summer student, TA/RA, student positions
    "entry",      # junior, associate (non-finance), analyst, coordinator, 0-2 yrs
    "mid",        # unqualified individual-contributor titles ("Engineer", "Accountant")
    "senior",     # senior / lead / staff / principal IC
    "manager",    # people manager, team lead, supervisor
    "director",   # director, head of, senior manager at large orgs
    "vp",         # VP, SVP, EVP, managing director (banking)
    "executive",  # C-suite, president, partner, founder, owner, dean, chief
    "unknown",
]

INDUSTRIES = [
    "software_internet", "hardware_semiconductors", "telecom",
    "banking", "investment_mgmt_pe_vc", "insurance", "fintech_payments",
    "management_consulting", "accounting_professional_services", "legal_services",
    "hospitals_healthcare", "pharma_biotech_medtech",
    "government_public_sector", "military_defence",
    "higher_education", "k12_education", "student_organization",
    "nonprofit_ngo", "energy_oil_gas", "mining_metals", "utilities_renewables",
    "manufacturing_industrial", "automotive_aerospace", "engineering_construction",
    "real_estate", "retail_consumer_goods", "food_beverage_hospitality",
    "media_entertainment_arts", "transportation_logistics", "agriculture",
    "sports_recreation", "self_employed_freelance", "other",
]

DISCIPLINES = [
    "engineering", "computing", "business_commerce", "economics", "law",
    "health_medicine_nursing", "life_sciences", "physical_sciences_math",
    "social_sciences", "humanities", "education", "fine_performing_arts",
    "public_policy_admin", "other",
]

CONTEXT = (
    "The data comes from LinkedIn profiles of Queen's University (Kingston, Canada) alumni, "
    "scraped in September 2025. Most people work in Canada. Inputs are raw, user-typed strings "
    "and may be in French, abbreviated, misspelled or contain noise."
)

TASKS = {
    "titles": {
        "system": f"""{CONTEXT}

You label job titles. For every input line "<id>\\t<title>" return one object:
- "i": the id, unchanged
- "fn": the job function, one of: {", ".join(FUNCTIONS)}
- "lvl": seniority, one of: {", ".join(SENIORITY)}
- "std": a short clean canonical title in English Title Case, dropping company names, team
  names and fluff (e.g. "Sr. SWE II - Payments @ Shopify" -> "Senior Software Engineer").
  Keep it under 6 words.
- "stu": true if this is a student/trainee role (intern, co-op, summer student, TA, RA,
  articling student, resident physician is false), else false.
- "amb": true if the function cannot be told from the title alone and depends on the
  employer (e.g. "Associate", "Analyst", "Manager", "Director", "Partner", "Intern",
  "Summer Student", "Coordinator"); still give your best-guess "fn". Else false.

Rules:
- Judge the title alone; when ambiguous pick the most common meaning in Canadian workplaces.
- "Associate" at a bank/consulting/law firm is entry level; "Analyst" is entry; "Partner" and
  "Principal" (consulting/law/PE) are executive; "Managing Director" is vp.
- Founder/co-founder/owner -> fn entrepreneurship_founder, lvl executive.
- Club or society roles ("President, Debating Union") -> fn other, stu true.
- If a line is not a job title at all, use fn other, lvl unknown, std "".
Return every id exactly once.""",
        "schema_item": {
            "i": {"type": "integer"},
            "fn": {"type": "string", "enum": FUNCTIONS},
            "lvl": {"type": "string", "enum": SENIORITY},
            "std": {"type": "string"},
            "stu": {"type": "boolean"},
            "amb": {"type": "boolean"},
        },
        "per_request": 200,
    },
    "companies": {
        "system": f"""{CONTEXT}

You label employers. For every input line "<id>\\t<company name>" return one object:
- "i": the id, unchanged
- "ind": industry, one of: {", ".join(INDUSTRIES)}
- "parent": the canonical name of the top-level organization, so subsidiaries and
  divisions roll up (e.g. "RBC Capital Markets" -> "RBC", "Smith School of Business at
  Queen's University" -> "Queen's University", "Deloitte Canada" -> "Deloitte").
  If it is already top level, repeat a cleaned-up version of the name.

Rules:
- University clubs, student governments, faculty societies, varsity teams and student-run
  businesses (e.g. "Alma Mater Society of Queen's University", "Queen's Engineering Society")
  -> student_organization, parent "Queen's University" if at Queen's.
- Hospitals and health authorities -> hospitals_healthcare. School boards -> k12_education.
- "Self-employed", "Freelance", "Independent" -> self_employed_freelance.
Return every id exactly once.""",
        "schema_item": {
            "i": {"type": "integer"},
            "ind": {"type": "string", "enum": INDUSTRIES},
            "parent": {"type": "string"},
        },
        "per_request": 200,
    },
    "fields": {
        "system": f"""{CONTEXT}

You normalize fields of study entered for a Queen's University degree. For every input line
"<id>\\t<field>" return one object:
- "i": the id, unchanged
- "prog": the canonical program name in English Title Case, using Queen's University's own
  department/program names where one fits (e.g. "PSYCHOLOGY", "Psych" -> "Psychology";
  "Business/Commerce, General", "Commerce" -> "Commerce"; "Political Science and Government",
  "Political Studies" -> "Political Studies"; "Mechanical and Materials Engineering" ->
  "Mechanical Engineering"; "Law", "JD" -> "Law"). Merge spelling and wording variants into
  one name. For double majors keep the first-named program.
- "disc": broad discipline, one of: {", ".join(DISCIPLINES)}
Return every id exactly once.""",
        "schema_item": {
            "i": {"type": "integer"},
            "prog": {"type": "string"},
            "disc": {"type": "string", "enum": DISCIPLINES},
        },
        "per_request": 200,
    },
}


PLACE_LEVELS = ["city", "metro", "region", "country", "remote", "unknown"]

TASKS["places"] = {
    "system": f"""{CONTEXT}

You geocode free-text locations from profiles and job entries. For every input line
"<id>\\t<location>" return one object:
- "i": the id, unchanged
- "level": the most specific thing the text names, one of: {", ".join(PLACE_LEVELS)}
  ("Greater Toronto Area" is metro; "Ontario, Canada" is region; "Canada" is country;
  "Remote" is remote; noise or a non-place is unknown)
- "city": canonical English city name ("Toronto", "New York", "Montréal" -> "Montreal"),
  "" unless level is city or metro
- "metro": the metropolitan area the place belongs to, named after its main city, so suburbs
  roll up ("Mississauga", "North York", "Oakville" -> "Toronto"; "Brooklyn", "Jersey City" ->
  "New York"; "Palo Alto", "San Jose" -> "San Francisco Bay Area"; "Gatineau" -> "Ottawa").
  "" unless level is city or metro
- "region": province/state/region name in English ("Ontario", "California", "England"), "" if none
- "country": ISO 3166-1 alpha-2 code ("CA", "US", "GB"), "" if unknown or remote
- "lat", "lon": decimal degrees of the city (or of the region/country centroid when that is
  the most specific level); 0 and 0 when unknown or remote

Rules:
- "Toronto, Canada Area" and "Greater Toronto Area" -> level metro, city "Toronto", metro "Toronto".
- Use the metro's main city coordinates for metro-level text.
- Prefer Canada when a name is ambiguous ("London, Ontario" vs "London" alone: "London" alone
  with no other context is London, England; "Kingston" alone is Kingston, Ontario).
Return every id exactly once.""",
    "schema_item": {
        "i": {"type": "integer"},
        "level": {"type": "string", "enum": PLACE_LEVELS},
        "city": {"type": "string"},
        "metro": {"type": "string"},
        "region": {"type": "string"},
        "country": {"type": "string"},
        "lat": {"type": "number"},
        "lon": {"type": "number"},
    },
    "per_request": 150,
}


def output_schema(task):
    item = TASKS[task]["schema_item"]
    return {
        "type": "object",
        "properties": {
            "labels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": item,
                    "required": list(item),
                    "additionalProperties": False,
                },
            }
        },
        "required": ["labels"],
        "additionalProperties": False,
    }
