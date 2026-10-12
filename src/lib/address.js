import { z } from 'zod'

const required = (label) => z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`)

/** მიწოდების ველები — ერთი წესები შენახული მისამართისთვისაც და ჩექაუთის ფორმისთვისაც */
export const addressFields = {
  fullName: required('Full name').pipe(z.string().min(2, 'Full name must be at least 2 characters')),
  phone: required('Phone').pipe(z.string().regex(/^\+?[\d\s-]{9,20}$/, 'Enter a valid phone number')),
  city: required('City').pipe(z.string().min(2, 'City must be at least 2 characters')),
  address: required('Address').pipe(z.string().min(5, 'Address must be at least 5 characters')),
}

export const shippingSchema = z.object(addressFields)
