import { useState } from "react";
import { motion } from "framer-motion";
import { Briefcase, Send } from "lucide-react";
import SectionReveal from "./SectionReveal";

export default function ProjectConsultation() {
  const [formData, setFormData] = useState({
    companyName: "",
    contactPerson: "",
    email: "",
    phone: "",
    website: "",

    projectTypes: [] as string[],
    websiteFeatures: [] as string[],

    orderConfirmation: "",
    orderTracking: "",
    paymentMethods: [] as string[],

    shipping: "",

    adminPanel: [] as string[],

    ownDomain: "",
    purchaseDomain: "",

    maintenance: "",

    inspiration: "",

    requirements: "",
  });
const [loading, setLoading] = useState(false);
const [status, setStatus] = useState("");

  const handleCheckbox = (
    field: "projectTypes" | "websiteFeatures" | "paymentMethods" | "adminPanel",
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
  };

  const handleRadio = (field: string, value: string) => {
    setFormData({
      ...formData,
      [field]: value,
    });
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };
const handleSubmit = async () => {
  setLoading(true);
  setStatus("");

  const response = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      access_key: "bb6e3339-a3c2-4c6e-ba58-f44f2c470a25",

      subject: `New Project Consultation - ${formData.companyName}`,

      companyName: formData.companyName,
      contactPerson: formData.contactPerson,
      email: formData.email,
      phone: formData.phone,
      website: formData.website,

      projectType: formData.projectTypes.join(", "),
      websiteFeatures: formData.websiteFeatures.join(", "),

      orderConfirmation: formData.orderConfirmation,
      orderTracking: formData.orderTracking,
      paymentMethods: formData.paymentMethods.join(", "),

      shipping: formData.shipping,

      adminPanel: formData.adminPanel.join(", "),

      ownDomain: formData.ownDomain,
      purchaseDomain: formData.purchaseDomain,

      maintenance: formData.maintenance,

      inspiration: formData.inspiration,

      requirements: formData.requirements,
    }),
  });

  const result = await response.json();

  if (result.success) {
    setStatus("✅ Consultation request submitted successfully!");

    setFormData({
      companyName: "",
      contactPerson: "",
      email: "",
      phone: "",
      website: "",
      projectTypes: [],
      websiteFeatures: [],
      orderConfirmation: "",
      orderTracking: "",
      paymentMethods: [],
      shipping: "",
      adminPanel: [],
      ownDomain: "",
      purchaseDomain: "",
      maintenance: "",
      inspiration: "",
      requirements: "",
    });
  } else {
    setStatus("❌ Submission failed. Please try again.");
  }

  setLoading(false);
};

  return (
    <section
      id="consultation"
      className="relative py-32 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6">

        <SectionReveal>

          <div className="text-center mb-16">

            <span className="inline-block px-4 py-2 rounded-full glass text-cyan-400 text-sm mb-4">
              Start Your Project
            </span>

            <h2 className="text-5xl font-bold mb-6">
              Let's Build Something
              <span className="gradient-text">
                {" "}Amazing
              </span>
            </h2>

            <p className="text-text-secondary max-w-3xl mx-auto">
              Tell us about your project and we'll get back to you
              with a detailed proposal.
            </p>

          </div>

        </SectionReveal>

        <div className="glass rounded-3xl p-10">

          {/* BUSINESS INFORMATION */}

          <div className="mb-16">

            <div className="flex items-center gap-3 mb-8">

              <Briefcase className="w-7 h-7 text-cyan-400" />

              <h3 className="text-3xl font-bold">
                Business Information
              </h3>

            </div>

            <div className="grid md:grid-cols-2 gap-6">

              <input
                name="companyName"
                value={formData.companyName}
                onChange={handleChange}
                placeholder="Company Name"
                className="glass rounded-xl p-4"
              />

              <input
                name="contactPerson"
                value={formData.contactPerson}
                onChange={handleChange}
                placeholder="Contact Person"
                className="glass rounded-xl p-4"
              />

              <input
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Email"
                className="glass rounded-xl p-4"
              />

              <input
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="Phone Number"
                className="glass rounded-xl p-4"
              />

              <input
                name="website"
                value={formData.website}
                onChange={handleChange}
                placeholder="Existing Website (Optional)"
                className="glass rounded-xl p-4 md:col-span-2"
              />

            </div>

          </div>

          {/* PROJECT TYPE */}

          <div className="mb-16">

            <h3 className="text-3xl font-bold mb-8">

              Project Type

            </h3>

            <div className="grid md:grid-cols-2 gap-5">

              {[
                "Business Website",
                "E-commerce Website",
                "Mobile App",
                "Custom Software",
                "AI Solution",
                "Other",
              ].map((item) => (

                <label
                  key={item}
                  className="glass rounded-xl p-5 flex items-center gap-4 cursor-pointer hover:border-cyan-400 transition"
                >

                  <input
                    type="checkbox"
                    checked={formData.projectTypes.includes(item)}
                    onChange={() =>
                      handleCheckbox("projectTypes", item)
                    }
                  />

                  {item}

                </label>

              ))}

            </div>

          </div>

          {/* WEBSITE FEATURES */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Website Features
  </h3>

  <div className="grid md:grid-cols-2 gap-5">

    {[
      "Home Page",
      "About Us",
      "Products / Services",
      "Search",
      "Filters",
      "Shopping Cart",
      "Online Payments",
      "Customer Login",
      "Wishlist",
      "Contact Page",
    ].map((item) => (

      <label
        key={item}
        className="glass rounded-xl p-5 flex items-center gap-4 cursor-pointer hover:border-cyan-400 transition"
      >

        <input
          type="checkbox"
          checked={formData.websiteFeatures.includes(item)}
          onChange={() =>
            handleCheckbox("websiteFeatures", item)
          }
        />

        {item}

      </label>

    ))}

  </div>

</div>

{/* ORDERS & PAYMENTS */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Orders & Payments
  </h3>

  <div className="space-y-10">

    <div>

      <h4 className="font-semibold mb-4">
        Do you need order confirmation emails?
      </h4>

      <div className="flex gap-8">

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.orderConfirmation === "Yes"}
            onChange={() =>
              handleRadio("orderConfirmation", "Yes")
            }
          />
          Yes
        </label>

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.orderConfirmation === "No"}
            onChange={() =>
              handleRadio("orderConfirmation", "No")
            }
          />
          No
        </label>

      </div>

    </div>

    <div>

      <h4 className="font-semibold mb-4">
        Do you need order tracking?
      </h4>

      <div className="flex gap-8">

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.orderTracking === "Yes"}
            onChange={() =>
              handleRadio("orderTracking", "Yes")
            }
          />
          Yes
        </label>

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.orderTracking === "No"}
            onChange={() =>
              handleRadio("orderTracking", "No")
            }
          />
          No
        </label>

      </div>

    </div>

    <div>

      <h4 className="font-semibold mb-4">
        Preferred Payment Methods
      </h4>

      <div className="grid md:grid-cols-2 gap-5">

        {[
          "UPI",
          "Credit Card",
          "Debit Card",
          "Net Banking",
          "Cash on Delivery",
        ].map((item) => (

          <label
            key={item}
            className="glass rounded-xl p-4 flex items-center gap-3 cursor-pointer"
          >

            <input
              type="checkbox"
              checked={formData.paymentMethods.includes(item)}
              onChange={() =>
                handleCheckbox("paymentMethods", item)
              }
            />

            {item}

          </label>

        ))}

      </div>

    </div>

  </div>

</div>

{/* SHIPPING */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Shipping
  </h3>

  <div className="grid md:grid-cols-2 gap-5">

    {[
      "Bengaluru",
      "Karnataka",
      "All India",
      "International",
    ].map((item) => (

      <label
        key={item}
        className="glass rounded-xl p-5 flex items-center gap-4 cursor-pointer"
      >

        <input
          type="radio"
          checked={formData.shipping === item}
          onChange={() =>
            handleRadio("shipping", item)
          }
        />

        {item}

      </label>

    ))}

  </div>

</div>

{/* ADMIN PANEL */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Admin Panel
  </h3>

  <div className="grid md:grid-cols-2 gap-5">

    {[
      "Manage Products",
      "Update Prices",
      "View Orders",
      "Manage Customers",
    ].map((item) => (

      <label
        key={item}
        className="glass rounded-xl p-5 flex items-center gap-4 cursor-pointer"
      >

        <input
          type="checkbox"
          checked={formData.adminPanel.includes(item)}
          onChange={() =>
            handleCheckbox("adminPanel", item)
          }
        />

        {item}

      </label>

    ))}

  </div>

</div>

          {/* DOMAIN & HOSTING */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Domain & Hosting
  </h3>

  <div className="space-y-10">

    <div>

      <h4 className="font-semibold mb-4">
        Do you already own a domain?
      </h4>

      <div className="flex gap-8">

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.ownDomain === "Yes"}
            onChange={() => handleRadio("ownDomain", "Yes")}
          />
          Yes
        </label>

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.ownDomain === "No"}
            onChange={() => handleRadio("ownDomain", "No")}
          />
          No
        </label>

      </div>

    </div>

    <div>

      <h4 className="font-semibold mb-4">
        Should SHYGON purchase and configure one?
      </h4>

      <div className="flex gap-8">

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.purchaseDomain === "Yes"}
            onChange={() => handleRadio("purchaseDomain", "Yes")}
          />
          Yes
        </label>

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={formData.purchaseDomain === "No"}
            onChange={() => handleRadio("purchaseDomain", "No")}
          />
          No
        </label>

      </div>

    </div>

  </div>

</div>

{/* MAINTENANCE */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Maintenance
  </h3>

  <div className="grid md:grid-cols-3 gap-5">

    {[
      "Monthly",
      "Yearly",
      "No",
    ].map((item) => (

      <label
        key={item}
        className="glass rounded-xl p-5 flex items-center gap-3 cursor-pointer"
      >

        <input
          type="radio"
          checked={formData.maintenance === item}
          onChange={() => handleRadio("maintenance", item)}
        />

        {item}

      </label>

    ))}

  </div>

</div>

{/* DESIGN */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Design Inspiration
  </h3>

  <textarea
    name="inspiration"
    rows={4}
    value={formData.inspiration}
    onChange={handleChange}
    placeholder="Please share 2–3 websites you like..."
    className="glass rounded-xl p-5 w-full resize-none"
  />

</div>

{/* REQUIREMENTS */}

<div className="mb-16">

  <h3 className="text-3xl font-bold mb-8">
    Additional Requirements
  </h3>

  <textarea
    name="requirements"
    rows={7}
    value={formData.requirements}
    onChange={handleChange}
    placeholder="Tell us anything else you'd like us to know..."
    className="glass rounded-xl p-5 w-full resize-none"
  />

</div>

{/* BUTTON */}

<div className="text-center">

  <motion.button

    whileHover={{ scale: 1.03 }}

    whileTap={{ scale: 0.97 }}

    onClick={handleSubmit}

    className="px-12 py-5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 font-semibold text-lg flex items-center gap-3 mx-auto hover:shadow-2xl hover:shadow-cyan-500/40 transition-all"

  >

    <Send className="w-5 h-5"/>

    {loading ? "Submitting..." : "Request a Free Consultation"}

  </motion.button>
{status && (
  <p className="mt-6 text-cyan-400 font-semibold text-center">
    {status}
  </p>
)}

</div>

        </div>

      </div>

    </section>
  );
}