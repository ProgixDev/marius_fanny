// Shared delivery / pickup time slot configuration.
// Mirrors the logic used on the public Checkout page so that the admin
// OrderForm offers exactly the same choices.

export type DeliveryType = "pickup" | "delivery";
export type PickupLocation = "Montreal" | "Laval" | undefined;

const PICKUP_SLOTS_BASE = [
  "07:00",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
];

const DELIVERY_WEEKEND = [
  "08:00 - 09:00",
  "09:00 - 10:00",
  "10:00 - 11:00",
  "11:00 - 12:00",
];

const DELIVERY_WEEKDAY = [
  // Créneau du matin ajouté le 28 septembre 2026 (demande de Fanny) :
  // livraison entre 7 h et 8 h, du lundi au vendredi seulement.
  "07:00 - 08:00",
  "08:00 - 09:00",
  "09:00 - 10:00",
  "10:00 - 11:00",
  "11:00 - 11:30",
  "11:30 - 12:00",
  "12:00 - 12:30",
  "12:30 - 13:00",
  "13:00 - 13:30",
  "13:30 - 14:00",
];

export function getAvailableTimeSlots(
  selectedDate: string,
  deliveryType: DeliveryType,
  pickupLocation?: PickupLocation,
): string[] {
  if (!selectedDate) return [];

  if (deliveryType === "pickup") {
    const slots = [...PICKUP_SLOTS_BASE];
    if (pickupLocation !== "Montreal") slots.push("18:00");
    return slots;
  }

  const date = new Date(`${selectedDate}T00:00:00`);
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return DELIVERY_WEEKEND;
  return DELIVERY_WEEKDAY;
}
