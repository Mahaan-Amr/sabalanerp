#!/usr/bin/perl
# Signal a reviewed process through a pidfd, never a reusable numeric PID.
# The QA WSL host is pinned to Linux x86_64 (pidfd_open=434,
# pidfd_send_signal=424). No process is signalled on any mismatch.
use strict;
use warnings;
use Config;

@ARGV == 5 or die "usage: qa-owned-pid-signal.pl PID BIRTH EXES NETNSES SIGNAL\n";
my ($pid, $birth, $exes, $netnses, $signal) = @ARGV;
$pid =~ /^[1-9][0-9]*$/ or die "invalid PID\n";
$birth =~ /^[1-9][0-9]*$/ or die "invalid birth\n";
$signal =~ /^(?:0|15|9)$/ or die "invalid signal\n";
my @allowed_exes = split /,/, $exes;
my @allowed_netnses = split /,/, $netnses;
@allowed_exes && @allowed_netnses or die "empty identity\n";
for (@allowed_exes) { m{^/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$} or die "invalid executable\n"; }
for (@allowed_netnses) { /^net:\[[1-9][0-9]*\]$/ or die "invalid namespace\n"; }
$Config{archname} =~ /^x86_64-linux/ or die "unreviewed architecture\n";

# Open first, then verify the numeric PID still refers to the same process.
# If it exits and the number is reused afterward, the pidfd still points only
# to the original process and pidfd_send_signal returns ESRCH.
my $fd = syscall(434, int($pid), 0);
$fd >= 0 or die "pidfd_open failed: $!\n";
open my $stat, '<', "/proc/$pid/stat" or die "process stat unavailable: $!\n";
my $raw = <$stat>;
close $stat;
$raw =~ /^[0-9]+ \(.*\) (.*)$/ or die "invalid process stat\n";
my @fields = split /\s+/, $1;
defined $fields[19] && $fields[19] eq $birth or die "PID birth mismatch\n";
my $actual_exe = readlink "/proc/$pid/exe";
defined $actual_exe && grep { $_ eq $actual_exe } @allowed_exes or die "executable mismatch\n";
my $actual_netns = readlink "/proc/$pid/ns/net";
defined $actual_netns && grep { $_ eq $actual_netns } @allowed_netnses or die "network namespace mismatch\n";
if ($signal != 0) {
  syscall(424, $fd, int($signal), 0, 0) == 0 or die "pidfd_send_signal failed: $!\n";
}
