#!/usr/bin/env python3

import os
import re

MAX_SIZE_IN_MIB = 800

def get_dir_size(path):
  size = 0
  for path, subdirs, files in os.walk(path):
    for name in files:
      size += os.path.getsize(os.path.join(path, name))
  return size

version_pattern = re.compile("^v(\d+)\.(\d+)\.(\d+)\+harmonic$")

dir = os.path.dirname(__file__)
files = os.listdir(dir)

release_dict = {}
total_size = 0
for f in files:
  if not os.path.isdir(f):
    continue

  matched = version_pattern.match(f)
  if not matched:
    continue

  major = int(matched.group(1))
  minor = int(matched.group(2))
  patch = int(matched.group(3))
  size = get_dir_size(os.path.join(dir, f))

  if not (major,minor) in release_dict:
    release_dict[(major,minor)] = []
  patches = release_dict[(major,minor)]
  patches.append((patch, f, size))
  total_size += size

release_list = [{"major_minor": k, "patches": sorted(v)} for k,v in sorted(release_dict.items())]

projected_size = total_size
delete_list = []
latest_major_minor = release_list[-1]["major_minor"]

for m in release_list[0:-1]:
  if projected_size <= MAX_SIZE_IN_MIB * 1048576:
    break
  for p in m["patches"][0:-1]:
    if projected_size <= MAX_SIZE_IN_MIB * 1048576:
      break
    delete_list.append(p[1])
    projected_size -= p[2]

for m in release_list:
  print("%d.%d:" % m["major_minor"])
  for p in m["patches"]:
    print("  %s (%.1fMiB)%s" % (p[1], p[2]/1048576.0, " deleting" if p[1] in delete_list else ""))

if len(delete_list) > 0:
  print("Total size: %0.1fMiB, expected size after deletion: %0.1fMiB" % (total_size/1048576.0, projected_size/1048576.0))
  confirm = input('Confirm delete (y/n)? ')
  if confirm == 'y' or confirm == 'Y':
    comma_sep_list = " ".join(delete_list)
    os.system("git rm -r %s" % comma_sep_list)
    print("Deleted, please commit change to VCS.")
else:
  print("Total size: %0.1fMiB, skipped deletion" % (total_size/1048576.0))

