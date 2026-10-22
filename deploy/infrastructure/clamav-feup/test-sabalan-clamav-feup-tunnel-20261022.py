"""Pure parser/firewall construction and local socketpair tests; no server access."""
import copy,errno,importlib.util,ipaddress,json,pathlib,socket,struct,threading,time,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('fixed_feup_tunnel',pathlib.Path(__file__).with_name('sabalan-clamav-feup-tunnel-20261022.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def name(value):return b''.join(bytes([len(x)])+x.encode()for x in value.split('.'))+b'\0'
def dns_packet(kind,value,ident=42):
 q=name(m.HOST)+struct.pack('!HH',kind,1);data=ipaddress.ip_address(value).packed
 return struct.pack('!6H',ident,0x8180,1,1,0,0)+q+b'\xc0\x0c'+struct.pack('!HHIH',kind,1,60,len(data))+data
class Dns(unittest.TestCase):
 def test_actual_question_compression_and_public_ipv4(self):
  self.assertEqual(m.dns_answer(dns_packet(1,'1.1.1.1'),42,1),(['1.1.1.1'],60))
 def test_cname_chain_keeps_target_owner_and_minimum_ttl(self):
  alias='mirror.example.net';q=name(m.HOST)+struct.pack('!HH',1,1);cn=name(alias)
  r=b'\xc0\x0c'+struct.pack('!HHIH',5,1,30,len(cn))+cn+name(alias)+struct.pack('!HHIH',1,1,90,4)+socket.inet_aton('8.8.8.8')
  self.assertEqual(m.dns_answer(struct.pack('!6H',42,0x8180,1,2,0,0)+q+r,42,1),(['8.8.8.8'],30))
 def test_wrong_id_private_ip_truncation_and_pointer_cycle_fail(self):
  for raw in [dns_packet(1,'1.1.1.1',43),dns_packet(1,'127.0.0.1'),dns_packet(1,'1.1.1.1')[:-1]]:
   with self.assertRaises(RuntimeError):m.dns_answer(raw,42,1)
  with self.assertRaises(RuntimeError):m.dns_name(b'\xc0\x00',0)
 def test_actual_ipv6_answer_requires_separate_physical_gate_and_packet_receipt_deadline(self):
  class Query:
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def settimeout(self,*_):pass
   def connect(self,target):self.target=target
   def send(self,raw):self.ident=struct.unpack('!H',raw[:2])[0];self.kind=struct.unpack('!H',raw[-4:-2])[0]
   def recv(self,_):return dns_packet(self.kind,'1.1.1.1'if self.kind==1 else'2606:4700::1111',self.ident)
  with patch.object(m.socket,'socket',return_value=Query()),patch.object(m.time,'monotonic',side_effect=[100,110,120]):
   result=m.resolve();self.assertEqual(result['ipv6'],['2606:4700::1111']);self.assertEqual(result['expiresMonotonic'],160)
class Firewall(unittest.TestCase):
 base='*nat\n:PREROUTING ACCEPT [1:2]\n:OUTPUT ACCEPT [0:0]\n:FOREIGN - [0:0]\n-A OUTPUT -d 8.8.8.8/32 -j FOREIGN\nCOMMIT\n'
 token='a'*32
 def existing(self):return self.base.replace('COMMIT',':'+m.CHAIN+' - [0:0]\n'+m.redirect_rule(self.token)+'\n'+m.marker_rule(self.token)+'\n'+m.jump('1.1.1.1',self.token)+'\nCOMMIT')
 def empty(self):return self.base.replace('COMMIT',':'+m.CHAIN+' - [0:0]\nCOMMIT')
 def test_initialization_can_only_append_to_originally_created_empty_chain(self):
  transaction=m.nat_transaction(self.empty(),['1.1.1.1'],self.token,'initialize')
  self.assertIn(m.marker_rule(self.token),transaction);self.assertIn(m.jump('1.1.1.1',self.token),transaction)
  self.assertNotIn('-F OUTPUT',transaction);self.assertNotIn('-F FOREIGN',transaction);self.assertNotIn('--flush',transaction)
  self.assertNotIn('-F ',transaction)
  with self.assertRaises(RuntimeError):m.nat_transaction(self.base,['1.1.1.1'],self.token,'initialize')
 def test_replacement_and_removal_only_touch_exact_owned_rules(self):
  existing=self.existing();self.assertEqual(m.owned_rules(existing,self.token)[1],['1.1.1.1'])
  replacement=m.nat_transaction(existing,['8.8.4.4'],self.token,'update');self.assertIn(m.jump('1.1.1.1',self.token).replace('-A OUTPUT','-D OUTPUT'),replacement)
  self.assertNotIn('-F ',replacement);self.assertIn(m.jump('8.8.4.4',self.token),replacement)
  removal=m.nat_transaction(existing,[],self.token,'remove');self.assertIn('-X '+m.CHAIN,removal);self.assertNotIn('-X FOREIGN',removal);self.assertNotIn('-F ',removal)
 def test_foreign_rule_reference_and_private_destination_rejected(self):
  for extra in ['-A '+m.CHAIN+' -j ACCEPT','-A FOREIGN -g '+m.CHAIN,m.jump('1.1.1.1',self.token).replace('1.1.1.1','127.0.0.1')]:
   data=self.base.replace('COMMIT',':'+m.CHAIN+' - [0:0]\n'+extra+'\nCOMMIT')
   with self.assertRaises(RuntimeError):m.nat_transaction(data,['1.1.1.1'],self.token,'update')
 def test_comments_quote_normalization_and_foreign_counters(self):
  existing=self.existing().replace('"','');self.assertEqual(m.owned_rules(existing,self.token)[1],['1.1.1.1']);self.assertEqual(m.foreign_rules(existing),m.foreign_rules(self.base.replace('[1:2]','[77:999]')))
 def test_existing_same_shaped_chain_cannot_be_adopted(self):
  for token in (None,'b'*32):
   with self.assertRaises(RuntimeError):m.owned_rules(self.existing(),token)
 def test_racing_create_failure_never_sets_ownership_or_tears_down(self):
  owner=m.NatOwner(17);calls=[];clock=type('Deadline',(),{'check':lambda _:None})()
  def command(argv,*args,**kwargs):
   calls.append(argv)
   if '-N'in argv:raise RuntimeError('RACING_CHAIN_EXISTS')
   return b'iptables v1.8.10 (nf_tables)'
  with patch.object(owner,'snapshot',return_value=self.base),patch.object(m,'command',side_effect=command):
   with self.assertRaisesRegex(RuntimeError,'RACING_CHAIN'):owner.create(['1.1.1.1'],clock)
   owner.remove()
  self.assertFalse(owner.created);self.assertFalse(any('-X'in row or '--noflush'in row for row in calls))
 def test_successful_create_initializes_and_removes_only_its_nonce(self):
  owner=m.NatOwner(17);owner.token=self.token;calls=[];clock=type('Deadline',(),{'check':lambda _:None})()
  def command(argv,*args,**kwargs):calls.append((argv,args));return b'iptables v1.8.10 (nf_tables)'if '--version'in argv else b''
  with patch.object(owner,'snapshot',side_effect=[self.base,self.empty(),self.existing(),self.existing(),self.base]),patch.object(m,'command',side_effect=command):
   owner.create(['1.1.1.1'],clock);self.assertTrue(owner.created);owner.remove();self.assertFalse(owner.created)
  self.assertTrue(any('-N'in row[0]for row in calls));self.assertFalse(any(b'-F 'in arg for row in calls for arg in row[1]if isinstance(arg,bytes)))

class PhysicalIpv6(unittest.TestCase):
 def fixture(self):
  settings={key:{'disable_ipv6':'1'if key=='eth0'else'0','accept_ra':'1','forwarding':'0'}for key in ('all','default','eth0','lo')}
  return {'links':[{'ifname':'lo','flags':['LOOPBACK']},{'ifname':'eth0','flags':['UP']}],'settings':settings,'addresses':[{'ifname':'lo','addr_info':[{'family':'inet6','local':'::1','prefixlen':128,'scope':'host'}]}],'routes':[{'type':'local','dst':'::1','dev':'lo'}]},{'interfaces':['eth0'],'settings':copy.deepcopy(settings)}
 def test_exact_existing_disabled_interface_and_loopback_only_are_eligible(self):
  observed,expected=self.fixture();self.assertTrue(m.validate_ipv6_snapshot(observed,expected))
 def test_enabled_new_interface_global_address_route_or_changed_flags_refuse(self):
  source,expected=self.fixture()
  for mutate in [lambda v:v['settings']['eth0'].update(disable_ipv6='0'),lambda v:v['links'].append({'ifname':'eth1','flags':[]}),lambda v:v['addresses'].append({'ifname':'eth0','addr_info':[]}),lambda v:v['routes'].append({'dst':'default','dev':'eth0'}),lambda v:v['settings']['default'].update(accept_ra='0')]:
   changed=copy.deepcopy(source);mutate(changed)
   with self.assertRaises(RuntimeError):m.validate_ipv6_snapshot(changed,expected)
 def test_every_actual_aaaa_must_have_immediate_kernel_enetunreach(self):
  source,expected=self.fixture();p={'ipv6Isolation':expected}
  class Stream:
   code=errno.ENETUNREACH
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def settimeout(self,*_):pass
   def connect_ex(self,*_):return self.code
  with patch.object(m,'ipv6_snapshot',return_value=source),patch.object(m.socket,'socket',return_value=Stream()):
   result=m.prove_ipv6_unreachable(p,['2606:4700::1111']);self.assertEqual(result['attempts'][0]['errnoName'],'ENETUNREACH')
   for code in (0,errno.ECONNREFUSED,errno.EHOSTUNREACH,errno.ETIMEDOUT):
    Stream.code=code
    with self.assertRaises(RuntimeError):m.prove_ipv6_unreachable(p,['2606:4700::1111'])

class AbsoluteDeadline(unittest.TestCase):
 def test_initial_gateway_tls_cannot_outlive_initial_dns_before_refresh(self):
  now=[10.];deadline=m.DnsDeadline(20.,lambda:None,clock=lambda:now[0]);child=type('Child',(),{'poll':lambda _:None})()
  def tls(_):now[0]=21.;return {'httpStatus':200}
  with patch.object(m,'qualification',side_effect=tls),patch.object(m,'observe')as observation:
   with self.assertRaisesRegex(RuntimeError,'EXPIRED'):m.guarded_gateway_proof(17,{},child,deadline)
   observation.assert_not_called()
  with self.assertRaises(RuntimeError):deadline.replace(100.)
 def test_blocking_observe_cannot_emit_a_qualified_target_after_expiry(self):
  now=[10.];deadline=m.DnsDeadline(20.,lambda:None,clock=lambda:now[0]);child=type('Child',(),{'poll':lambda _:None})()
  def observation(_):now[0]=21.;return {'containerId':'unchanged'}
  with patch.object(m,'observe',side_effect=observation):
   with self.assertRaisesRegex(RuntimeError,'EXPIRED'):m.guarded_target({},child,deadline)
 def test_late_query_or_tls_completion_cannot_extend_an_expired_deadline(self):
  now=[10.];actions=[];deadline=m.DnsDeadline(20.,lambda:actions.append('kill-original-gateway'),clock=lambda:now[0]);now[0]=21.
  with self.assertRaisesRegex(RuntimeError,'EXPIRED'):deadline.replace(100.)
  self.assertTrue(deadline.poll());self.assertEqual(actions,['kill-original-gateway']);now[0]=11.
  with self.assertRaises(RuntimeError):deadline.replace(100.)
 def test_independent_watchdog_fires_while_caller_is_blocked(self):
  closed=threading.Event();deadline=m.DnsDeadline(time.monotonic()+.04,closed.set);deadline.start()
  try:self.assertTrue(closed.wait(1));self.assertTrue(deadline.failed.is_set())
  finally:deadline.close()
class Proxy(unittest.TestCase):
 def test_connect_fixed_destination_and_retains_post_header_bytes(self):
  class Stream:
   def __init__(self):self.parts=[b'HTTP/1.1 200 Connection',b' established\r\n\r\n\x16tls'];self.sent=b''
   def settimeout(self,*_):pass
   def sendall(self,data):self.sent+=data
   def recv(self,_):return self.parts.pop(0)
  stream=Stream();self.assertEqual(m.connect_proxy(stream),b'\x16tls');self.assertEqual(stream.sent,b'CONNECT mirrors.fe.up.pt:443 HTTP/1.1\r\nHost: mirrors.fe.up.pt:443\r\n\r\n')
 def test_refused_or_oversized_connect_never_becomes_tunnel(self):
  class Stream:
   def __init__(self,value):self.value=value
   def settimeout(self,*_):pass
   def sendall(self,*_):pass
   def recv(self,_):return self.value
  for value in (b'HTTP/1.1 403 Forbidden\r\n\r\n',b'x'*32769):
   with self.assertRaises(RuntimeError):m.connect_proxy(Stream(value))
 def test_real_socketpair_backpressure_bidirectional_payload_and_half_close(self):
  client,left=socket.socketpair();right,server=socket.socketpair();errors=[];request=b'a'*(m.BUFFER*4+7);response=b'b'*(m.BUFFER*3+11)
  for stream in (client,left,right,server):stream.settimeout(8)
  def tunnel():
   try:m.relay(left,right,stop=threading.Event(),idle=5)
   except BaseException as error:errors.append(error)
   finally:left.close();right.close()
  def peer():
   try:
    data=b''
    while part:=server.recv(32768):data+=part
    self.assertEqual(data,request);server.sendall(response);server.shutdown(socket.SHUT_WR)
   except BaseException as error:errors.append(error)
   finally:server.close()
  a=threading.Thread(target=tunnel,daemon=True);b=threading.Thread(target=peer,daemon=True);a.start();b.start()
  try:
   client.sendall(request);client.shutdown(socket.SHUT_WR);received=b''
   while part:=client.recv(32768):received+=part
   self.assertEqual(received,response)
  finally:client.close();a.join(8);b.join(8)
  self.assertFalse(a.is_alive());self.assertFalse(b.is_alive());self.assertEqual(errors,[])
if __name__=='__main__':unittest.main()
