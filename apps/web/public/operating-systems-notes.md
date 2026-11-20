# Process Scheduling

The CPU scheduler picks which ready process runs next. First Come First Served (FCFS) runs processes in arrival order and is simple, but one long job can delay every short job behind it, which is called the convoy effect. Shortest Job First (SJF) gives the minimum average waiting time for a given set of processes. SJF can cause starvation because long processes may wait forever while short ones keep arriving. Round Robin gives each process a fixed time quantum and then moves it to the back of the ready queue. If the quantum is very large, Round Robin behaves like FCFS. Aging gradually raises the priority of waiting processes and is the standard fix for starvation.

# Deadlocks

A deadlock needs four conditions at the same time: mutual exclusion, hold and wait, no preemption and circular wait. Breaking any one of the four conditions prevents deadlock. The Banker's Algorithm avoids deadlock by granting a request only if the system stays in a safe state. A safe state is one where some ordering lets every process finish. A resource allocation graph with a cycle may contain a deadlock when resources have several instances.

# Memory Management

Paging splits physical memory into fixed-size frames and logical memory into pages of the same size. Paging removes external fragmentation but can still waste space inside the last page, which is internal fragmentation. The page table maps page numbers to frame numbers. The TLB is a small, fast cache that stores recent page table entries so most translations skip the memory lookup. Thrashing happens when a process spends more time swapping pages than executing. The working set model keeps the pages a process used recently in memory to reduce thrashing. Belady's anomaly means FIFO page replacement can produce more page faults when given more frames. LRU replacement does not suffer from Belady's anomaly.

# Synchronization

A race condition happens when the result depends on the order in which threads run. A critical section is code that touches shared data and must not run in two threads at once. A semaphore is an integer variable accessed only through the atomic wait and signal operations. A binary semaphore takes only the values 0 and 1 and can be used as a mutex. Peterson's solution handles mutual exclusion for exactly 2 processes using only shared memory. Busy waiting wastes CPU cycles because the waiting thread keeps checking a condition in a loop.

# File Systems

An inode stores a file's metadata and the addresses of its data blocks, but not the file name. Directories map file names to inode numbers. Contiguous allocation gives fast sequential access but suffers from external fragmentation. Linked allocation stores a pointer to the next block inside each block, so random access is slow. Indexed allocation keeps all block pointers of a file in one index block. A hard link is another directory entry that points to the same inode, while a symbolic link stores a path to another file.
