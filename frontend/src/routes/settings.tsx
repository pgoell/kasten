import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BUILD, useVersion, versionText } from "@/lib/app/build";
import {
  currentEndpoint,
  type Device,
  fetchHours,
  fetchPush,
  type PushHours,
  pushSupported,
  removeDevice,
  saveHours,
  subscribeHere,
  unsubscribeHere,
} from "@/lib/app/push/push";
import { BACK_LINK } from "@/lib/ui/overlay-styles";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const ROW_BUTTON =
  "min-h-11 shrink-0 rounded border px-3 text-k-13 transition-colors duration-(--k-hover) hover:border-k-ink pointer-fine:min-h-8 disabled:opacity-50";

/** The sentence a failed call shows: its own message when it has one, else the fallback. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const TIME_INPUT =
  "min-h-11 rounded border border-k-rule bg-k-bg px-2 text-k-13 tabular-nums pointer-fine:min-h-8";

/**
 * The settings page: the todo reminders a browser gets as a push, and when they may go. Each device that
 * subscribed is listed, and removing one stops its pushes; this browser's own subscription is
 * dropped too when it is the device removed.
 */
function Settings() {
  const queryClient = useQueryClient();
  const push = useQuery({ queryKey: ["push"], queryFn: fetchPush });
  const endpoint = useQuery({ queryKey: ["push", "endpoint"], queryFn: currentEndpoint });
  const [failed, setFailed] = useState<string | null>(null);

  const changed = () => void queryClient.invalidateQueries({ queryKey: ["push"] });

  const subscribe = useMutation({
    mutationFn: subscribeHere,
    onMutate: () => setFailed(null),
    onSuccess: changed,
    onError: (error) => setFailed(messageOf(error, "could not subscribe this device")),
  });

  const remove = useMutation({
    mutationFn: async (device: Device) => {
      await removeDevice(device.id);
      if (device.endpoint === endpoint.data) await unsubscribeHere();
    },
    onMutate: () => setFailed(null),
    onSuccess: changed,
    onError: (error) => setFailed(messageOf(error, "could not remove that device")),
  });

  const devices = push.data?.devices ?? [];
  const here = endpoint.data ?? null;
  const subscribed = devices.some((device) => device.endpoint === here);

  return (
    <main className="min-h-dvh bg-k-bg font-sans text-k-ink">
      <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-6 md:px-6 md:py-9">
        <a href="/" className={BACK_LINK}>
          ← Back to the notes
        </a>
        <h1 className="font-serif text-k-27">settings</h1>

        <section
          aria-labelledby="reminders-heading"
          className="flex flex-col gap-4 rounded-[var(--k-radius-8)] border border-k-rule bg-k-paper p-4 md:p-5"
        >
          <h2 id="reminders-heading" className="font-serif text-k-19">
            Reminders on this device
          </h2>

          {push.isError && <p className="text-k-13 text-k-muted">Could not load the devices.</p>}

          {push.data !== undefined && (
            <ThisDevice
              publicKey={push.data.public_key}
              subscribed={subscribed}
              pending={subscribe.isPending}
              onSubscribe={(publicKey) => subscribe.mutate(publicKey)}
            />
          )}

          {failed !== null && (
            <p role="alert" className="text-k-13 text-k-danger">
              {failed}
            </p>
          )}

          {push.data !== undefined && (
            <DeviceList
              devices={devices}
              here={here}
              pending={remove.isPending}
              onRemove={(device) => remove.mutate(device)}
            />
          )}
        </section>

        <HoursSection />
        <Version />
      </div>
    </main>
  );
}

/** The code this page runs: the release, or in development the commit of each half. */
function Version() {
  const version = useVersion();
  if (version === undefined) return null;
  return (
    <p data-testid="version" className="text-k-12 text-k-muted tabular-nums">
      Version {versionText(version, BUILD)}
    </p>
  );
}

/** The morning and goals pushes' times and the quiet hours, loaded once, saved with one button. */
function HoursSection() {
  const queryClient = useQueryClient();
  const hours = useQuery({ queryKey: ["push", "settings"], queryFn: fetchHours });
  const save = useMutation({
    mutationFn: saveHours,
    onSuccess: (stored) => queryClient.setQueryData(["push", "settings"], stored),
  });

  return (
    <section
      aria-labelledby="hours-heading"
      className="flex flex-col gap-4 rounded-[var(--k-radius-8)] border border-k-rule bg-k-paper p-4 md:p-5"
    >
      <h2 id="hours-heading" className="font-serif text-k-19">
        When reminders go
      </h2>
      {hours.isError && <p className="text-k-13 text-k-muted">Could not load the times.</p>}
      {hours.data !== undefined && (
        <HoursForm
          stored={hours.data}
          pending={save.isPending}
          saved={save.isSuccess}
          failed={save.isError ? messageOf(save.error, "could not save the times") : null}
          onSave={(body) => save.mutate(body)}
        />
      )}
    </section>
  );
}

/** One `HH:MM` input; empty means off. */
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={TIME_INPUT}
    />
  );
}

/** The four times as the user edits them, sent as null where left empty. */
function HoursForm({
  stored,
  pending,
  saved,
  failed,
  onSave,
}: {
  stored: PushHours;
  pending: boolean;
  saved: boolean;
  failed: string | null;
  onSave: (body: PushHours) => void;
}) {
  const [morning, setMorning] = useState(stored.morning ?? "");
  const [start, setStart] = useState(stored.quiet_start ?? "");
  const [end, setEnd] = useState(stored.quiet_end ?? "");
  const [goals, setGoals] = useState(stored.goals ?? "");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          morning: morning || null,
          quiet_start: start || null,
          quiet_end: end || null,
          goals: goals || null,
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-k-13 font-medium">
          Morning push at
          <TimeField label="Morning push time" value={morning} onChange={setMorning} />
        </span>
        <span className="text-k-12 text-k-muted">
          Today's due and scheduled todos, once a day. Leave empty for none.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-k-13 font-medium">
          Log goals push at
          <TimeField label="Log goals push time" value={goals} onChange={setGoals} />
        </span>
        <span className="text-k-12 text-k-muted">
          One push for each min goal of the log not met yet that day. Leave empty for none.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-k-13 font-medium">
          Quiet from
          <TimeField label="Quiet hours start" value={start} onChange={setStart} />
          to
          <TimeField label="Quiet hours end" value={end} onChange={setEnd} />
        </span>
        <span className="text-k-12 text-k-muted">
          A reminder due in them waits until they end. Leave both empty for none.
        </span>
      </div>
      {failed !== null && (
        <p role="alert" className="text-k-13 text-k-danger">
          {failed}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${ROW_BUTTON} border-k-ink bg-k-ink text-k-bg hover:opacity-85`}
        >
          Save times
        </button>
        {saved && <span className="text-k-13 text-k-muted">Saved</span>}
      </div>
    </form>
  );
}

/** The button that subscribes this browser, or a line saying why it cannot, or that it does. */
function ThisDevice({
  publicKey,
  subscribed,
  pending,
  onSubscribe,
}: {
  publicKey: string | null;
  subscribed: boolean;
  pending: boolean;
  onSubscribe: (publicKey: string) => void;
}) {
  if (!pushSupported()) {
    return <p className="text-k-13 text-k-muted">This browser cannot take push notifications.</p>;
  }
  if (subscribed) {
    return <p className="text-k-13">This device gets reminders</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {publicKey === null && (
        <p className="text-k-13 text-k-muted">Push is not set up on this server.</p>
      )}
      <button
        type="button"
        disabled={publicKey === null || pending}
        onClick={() => {
          if (publicKey !== null) onSubscribe(publicKey);
        }}
        className={`${ROW_BUTTON} self-start border-k-ink bg-k-ink text-k-bg hover:opacity-85`}
      >
        Send reminders to this device
      </button>
    </div>
  );
}

/** The subscribed devices, oldest first, each with its own Remove. */
function DeviceList({
  devices,
  here,
  pending,
  onRemove,
}: {
  devices: Device[];
  here: string | null;
  pending: boolean;
  onRemove: (device: Device) => void;
}) {
  if (devices.length === 0) {
    return <p className="text-k-13 text-k-muted">No device gets reminders yet.</p>;
  }
  return (
    <ul className="flex flex-col">
      {devices.map((device) => (
        <li
          key={device.id}
          className="flex min-h-14 items-center justify-between gap-3 border-k-rule border-t py-2 first:border-t-0"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-2 text-k-13 font-medium">
              <span className="min-w-0 truncate">{device.name}</span>
              {device.endpoint === here && (
                <span className="text-k-12 font-normal text-k-muted">this device</span>
              )}
            </span>
            <span className="text-k-12 text-k-muted tabular-nums">
              added {new Date(device.created).toISOString().slice(0, 10)}
            </span>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => onRemove(device)}
            className={`${ROW_BUTTON} border-transparent`}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
