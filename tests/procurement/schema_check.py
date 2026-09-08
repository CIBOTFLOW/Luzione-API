"""Offline draft contract checks. Requires jsonschema; no API/DB/model call."""
import copy
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator, FormatChecker
ROOT=Path(__file__).resolve().parents[2]
SCHEMA=json.loads((ROOT/'src/modules/procurement-contracts/evidence.schema.json').read_text())
V=Draft202012Validator(SCHEMA,format_checker=FormatChecker())
S={'schema_version':'procurement-evidence/v1-draft','packet_ref':'p1','environment_ref':'env1',
'as_of':'2026-09-01T00:00:00Z','documents':[],'order_lines':[],'acknowledgement_lines':[],'demands':[],
'limitations':['No source documents; no completeness or resolution claim.']}
LINE={'line_ref':'line1','version_ref':'v1','source_ref':'doc1','source_span':'page1:row2','item_ref':'chair',
'quantity':{'amount':'40','unit':'EA'},'price':{'amount':'250.00','currency':'EUR','per':{'amount':'1','unit':'EA'},'basis':'net_ex_tax_ex_freight'},
'spec_revision':'fabricA','dates':[{'kind':'required_on_site','earliest':'2026-10-20T00:00:00Z','latest':'2026-10-20T00:00:00Z','precision':'exact_instant','timezone':'UTC','source_ref':'phase1'}]}
class ContractTests(unittest.TestCase):
 def valid(self,p):self.assertEqual(list(V.iter_errors(p)),[])
 def invalid(self,p):self.assertTrue(list(V.iter_errors(p)))
 def test_schema(self):Draft202012Validator.check_schema(SCHEMA)
 def test_explicit_empty_observation_not_success(self):self.valid(S)
 def test_line_shape(self):p=copy.deepcopy(S);p['order_lines']=[copy.deepcopy(LINE)];self.valid(p)
 def test_missing_price_is_not_fabricated(self):p=copy.deepcopy(S);l=copy.deepcopy(LINE);l['price']=None;p['order_lines']=[l];self.valid(p)
 def test_calendar_date_without_invented_timezone(self):p=copy.deepcopy(S);l=copy.deepcopy(LINE);l['dates'][0].update(earliest='2026-10-20',latest='2026-10-20',precision='calendar_day',timezone=None);p['order_lines']=[l];self.valid(p)
 def test_no_actor_grant(self):p=copy.deepcopy(S);p['actor']='admin';self.invalid(p)
 def test_no_approval_flag(self):p=copy.deepcopy(S);p['approved']=True;self.invalid(p)
 def test_no_numeric_money(self):p=copy.deepcopy(S);l=copy.deepcopy(LINE);l['price']['amount']=250;p['order_lines']=[l];self.invalid(p)
 def test_no_float_quantity(self):p=copy.deepcopy(S);l=copy.deepcopy(LINE);l['quantity']['amount']=1.5;p['order_lines']=[l];self.invalid(p)
 def test_date_kind_required(self):p=copy.deepcopy(S);l=copy.deepcopy(LINE);l['dates'][0]['kind']='delivery';p['order_lines']=[l];self.invalid(p)
 def test_no_naive_asof(self):p=copy.deepcopy(S);p['as_of']='2026-09-01';self.invalid(p)
 def test_no_wrong_currency(self):p=copy.deepcopy(S);l=copy.deepcopy(LINE);l['price']['currency']='euro';p['order_lines']=[l];self.invalid(p)
if __name__=='__main__':unittest.main()
