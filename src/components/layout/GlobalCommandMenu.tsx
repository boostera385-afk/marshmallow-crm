import * as React from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useNavigate } from "react-router-dom";
import { UserPlus, Users, MessageSquare, BarChart3, Settings, Map as MapIcon, Calendar } from "lucide-react";
import AddLeadDialog from "@/components/leads/AddLeadDialog";
import { useAuth } from "@/contexts/AuthContext";
import { canAddManualLead } from "@/lib/access";

export function GlobalCommandMenu() {
  const [open, setOpen] = React.useState(false);
  const [addLeadOpen, setAddLeadOpen] = React.useState(false);
  const navigate = useNavigate();
  const { role, profile } = useAuth();
  const canCreateLead = canAddManualLead(role, profile);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = React.useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {canCreateLead && (
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => runCommand(() => setAddLeadOpen(true))}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                <span>Create New Lead</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>N
                </kbd>
              </CommandItem>
            </CommandGroup>
          )}
          {canCreateLead && <CommandSeparator />}
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => runCommand(() => navigate("/leads"))}>
              <Users className="mr-2 h-4 w-4" />
              <span>All Leads</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate("/quo-monitor"))}>
              <MessageSquare className="mr-2 h-4 w-4" />
              <span>QUO Inbox</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate("/schedule"))}>
              <Calendar className="mr-2 h-4 w-4" />
              <span>Schedule</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate("/map-view"))}>
              <MapIcon className="mr-2 h-4 w-4" />
              <span>Map View</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate("/analytics"))}>
              <BarChart3 className="mr-2 h-4 w-4" />
              <span>Analytics</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate("/settings"))}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {addLeadOpen && (
        <AddLeadDialog
          open={addLeadOpen}
          onOpenChange={setAddLeadOpen}
          onSuccess={() => {
            setAddLeadOpen(false);
          }}
        />
      )}
    </>
  );
}
