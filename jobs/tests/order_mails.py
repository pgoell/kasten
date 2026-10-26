"""Order mails made up in the shapes amazon.de and PayPal send, for the parsers' tests.

Every name, order id, transaction code and amount here is invented. The
layout follows the real mails: Amazon's plain part with its blank lines and
links, PayPal's HTML in table cells.
"""

from datetime import date

from kasten_jobs.gmail import Mail

DAY = date(2026, 10, 20)

AMAZON_FOOTER = """
Amazon.de is a trading name for Amazon EU Sarl. ©2026 Amazon.com, Inc. or its affiliates.

Privacy Notice https://www.amazon.de/gp/help/customer/display.html?nodeId=1
"""

CONFIRMATION = (
    """Your Orders

https://www.amazon.de/gp/css/order-history

    Thanks for your order!
Ordered

Dispatched




Arriving Thursday



Alex - Somewhere

Order #
111-2223334-4445556



View or edit order
https://www.amazon.de/your-orders/order-details?orderID=111-2223334-4445556

* Garden hose, 20 m, green
  Quantity: 1
  24.5 EUR

* Hose clip
  Quantity: \u20682\u2069
  1.25 EUR


Arriving Saturday

Order #
111-2223334-4445556

* Watering can
  Quantity: 1
  12.99 EUR




Total
40 EUR
"""
    + AMAZON_FOOTER
)

TWO_ORDERS = CONFIRMATION.replace(
    "Order #\n111-2223334-4445556\n\n* Watering can",
    "Order #\n111-9999999-0000001\n\n* Watering can",
)

DISPATCH = (
    """Your Orders

    Your package was dispatched!
Ordered

Dispatched

Arriving tomorrow

Order #
111-2223334-4445556

Track package
https://www.amazon.de/gp/your-account/ship-track?orderId=111-2223334-4445556

* Garden hose, 20 m, green
  Quantity: 1
  24.5 EUR

* Hose clip
  Quantity: \u20682\u2069
  1.25 EUR





Total
26.999999999999996 EUR
"""
    + AMAZON_FOOTER
)

DIGITAL = """

Hallo Alex,
Vielen Dank, dass Sie bei uns eingekauft haben.
 (www.amazon.de)


Bestellinformationen

Bestellnr.: [D01-1234567-7654321](https://www.amazon.de/o?orderID=D01-1234567-7654321) Aufgegeben\
am Dienstag, 20. Oktober 2026


My alt (https://www.amazon.de/dp/B000000000)

A Novel About Gardens (English Edition)
Verkauft von: Amazon Media EU S.\u200bà r.\u200bl.\u200b

Zwischensumme Artikel:  EUR 8,40
Gesamtbetrag vor Steuern:  EUR 8,40
Erhobene Steuer:  EUR 0,59
*Gesamtsumme:  EUR 8,99

Amazon.de
"""


def _cells(*lines: str) -> str:
    """Lines as PayPal lays them out: each in a table cell, some wrapped in spans."""
    rows = "".join(f"<tr><td><span>{line}</span></td></tr>" for line in lines)
    head = "<head><style>td {color: #000}</style></head>"
    return f"<html>{head}<body><table>{rows}</table></body></html>"


SHOP_PAYMENT = _cells(
    "Alex Example, Sie haben eine Zahlung gesendet.",
    "Hallo Alex Example!",
    "Sie haben <span>36,40&nbsp;€ EUR</span> an Example Shop GmbH gezahlt",
    "Händler",
    "Example Shop GmbH",
    "shop@example.com",
    "Transaktionsdatum",
    "20.10.2026",
    "Bestellnummer",
    "EX-12345",
    "Gartenschere",
    "Menge: 1",
    "19,90 €",
    "Handschuhe",
    "Menge: 2",
    "12,00 €",
    "Zwischensumme",
    "31,90 €",
    "Versand",
    "4,50 €",
    "Gesamtbetrag",
    "36,40 € EUR",
    "Example Shop GmbH bezahlt mit",
    "Deutsche Kreditbank AG",
    "Girokonto ••0000",
    "36,40 € EUR",
    "Transaktionscode: 1AB23456CD789012E",
)

TABLE_RECEIPT = _cells(
    "Alex Example, hier ist Ihr Beleg.",
    "Zahlung von",
    "Alex Example",
    "Zahlung an",
    "Example Software Ltd",
    "Transaktionscode",
    "2BC34567DE890123F",
    "Beschreibung",
    "Einzelpreis",
    "Menge",
    "Betrag",
    "Pro plan, one month",
    "16,81 € EUR",
    "1",
    "16,81 € EUR",
    "Versand und Verpackung",
    "0,00 € EUR",
    "Umsatzsteuer",
    "3,19 € EUR",
    "Rabatt",
    "-0,00 € EUR",
    "Summe",
    "20,00 € EUR",
    "Zahlungsquelle:",
    "Deutsche Kreditbank AG x-0000",
)

SENT_TO_A_PERSON = _cells(
    "Alex Example, hier ist Ihr Beleg.",
    "Du hast 25,00 € EUR an Sam Sample gesendet",
    "Transaktionsdetails",
    "Transaktionscode",
    "3CD45678EF901234G",
    "Transaktionsdatum",
    "18. Oktober 2026",
    "Geld gesendet",
    "25,00 € EUR",
)

IN_DOLLARS = _cells(
    "Sie haben 10,00 $ USD an Example Inc gezahlt",
    "Transaktionscode: 4DE56789FG012345H",
)

REFUND = _cells(
    "11,50 € EUR werden bis 23. Oktober 2026 zurückgezahlt.",
    "Deine Rückzahlung über 11,50 € EUR von Example Shop GmbH wurde veranlasst",
    "Rückzahlung an",
    "Deutsche Kreditbank AG ••0000",
    "Sie haben ursprünglich am 20. Oktober 2026 36,40 € EUR an Example Shop GmbH bezahlt. "
    "Beleg anzeigen",
)


def amazon_mail(mail_id: str, sender: str, text: str, day: date = DAY) -> Mail:
    return Mail(mail_id, day, f"Amazon.de <{sender}>", "Ordered", text, "<html></html>")


def paypal_mail(mail_id: str, html: str, day: date = DAY) -> Mail:
    return Mail(mail_id, day, '"service@paypal.de" <service@paypal.de>', "Beleg", "", html)
