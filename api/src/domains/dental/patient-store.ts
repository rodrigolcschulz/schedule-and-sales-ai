import { randomUUID } from "node:crypto";
import type { ScheduleStore } from "../../services/schedule-store.js";
import { serviceById } from "./catalog.js";

export type PatientAppointment = {
  id: string;
  bookingId: string;
  patientName: string;
  phone: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  notes?: string;
  createdAt: string;
};

/**
 * Store para pacientes e consultas.
 * Coordena com ScheduleStore para garantir que o slot seja reservado.
 */
export class PatientStore {
  private appointments = new Map<string, PatientAppointment>();

  createAppointment(
    schedule: ScheduleStore,
    input: {
      slotId: string;
      patientName: string;
      phone: string;
      serviceId: string;
      notes?: string;
    }
  ): PatientAppointment | { error: string } {
    const svc = serviceById(input.serviceId);
    if (!svc) return { error: "invalid_service" };

    const slots = schedule.getSlotsForDay(input.slotId.slice(0, 10));
    const slot = slots.find((s) => s.id === input.slotId);
    if (!slot) return { error: "invalid_slot" };

    const booking = schedule.createBooking({
      slotId: slot.id,
      startsAt: slot.startsAt,
      customerName: input.patientName,
      phone: input.phone,
    });

    if ("error" in booking) return { error: booking.error };

    const appt: PatientAppointment = {
      id: randomUUID(),
      bookingId: booking.id,
      patientName: booking.customerName,
      phone: booking.phone,
      serviceId: svc.id,
      serviceName: svc.name,
      startsAt: booking.startsAt,
      ...(input.notes ? { notes: input.notes } : {}),
      createdAt: new Date().toISOString(),
    };

    this.appointments.set(appt.id, appt);
    return appt;
  }

  listAppointmentsByPhone(phone: string): PatientAppointment[] {
    const p = phone.replace(/\D/g, "") || phone;
    return [...this.appointments.values()]
      .filter((a) => a.phone === p)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  listAll(): PatientAppointment[] {
    return [...this.appointments.values()].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt)
    );
  }

  cancelByBookingId(bookingId: string, schedule: ScheduleStore): boolean {
    const appt = [...this.appointments.values()].find(
      (a) => a.bookingId === bookingId
    );
    if (!appt) return false;
    schedule.cancelBooking(bookingId);
    this.appointments.delete(appt.id);
    return true;
  }
}
