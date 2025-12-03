General syntax and semantics

A statement is made up of an expression on the left-hand side, and labels on the right-hand side.
There can be zero, one, or many outputs to label per statement, depending on the expression.

As with most languages, the input parameters of a function can themselves be expressions, though each must have only one output.

Subcontracting and Abstraction participation are also considered functions, where the inputs and outputs are specific to the defined interface.

The language is declarative, not imperative, and labels are immutable.
A label can be defined (and assigned a value) only once, and ordering of statements does not affect when labels get values.

Literal Values

Inputs and Outputs are strongly typed. “Immediate” types (capitalised names) are types an Agent manipulates directly at design-time.

Integers

Set using several literal notations:

// decimal
42

// hexadecimal
-0x2A

// octal
0o52

// binary
-0b00101010

// integer range: -2^63 to (2^63)-1

Strings
// simple string
"Hello\n"

// hex escape
"Hello\x0a"

// multiple escaped bytes
"\x48\xb8"

// quotes and backslashes must be escaped
"This \"quote\" and \\ backslash"

Declarations
defaults
defaults: <layer>, <variation>, <platform>, <user>


Defines default identities for convenience. Common defaults include:

layer

variation (usually "default")

platform

asset
asset(name::STRING) -> document::SITE


Locally define the name of a document produced in a project. Used at top-level Pilot files.

Communications
job
job /<layer>/<verb>/<subject>/<variation>/<platform> ( <requirement parameters> )
    <obligation parameters> :


Defines:

design of an Agent

parameter labels

All classification parts must be explicit.

sub
sub /<layer>/<verb>/<subject>/<variation>/<platform> ( <requirement parameters> )
    -> <obligation parameters>


Subcontracts a supplier.

Defaults may apply.

join
join /<layer>/<subject>/<variation>/<platform> ( <requirement parameters> )
    -> <obligation parameters>


Participate as a join in a Collaboration group.

Example (from PDF)
join integer(the_integer_variable) -> minimum_value, maximum_value, memory_handle


(Image reference: Page 3)


host
host /<layer>/<subject>/<variation>/<platform> ( <requirement parameters> )
    -> <obligation parameters>


Participate as host in a Collaboration group.

deliver
deliver(document::SITE, input::STRING)


Return document content for a project.

def — Macro Definition

Define a macro block:

def doubleInt(flow_in, integer_in) integer_out:
    sub add/integer/with-constant-to-new-result(flow_in, integer_in, integer_in)
        -> integer_out
end


Macro instantiation:

flow -> {
    doubleInt($, i1) -> i2
    doubleInt($, i2) -> i3
}

Operations

Operator precedence (from PDF table):

order	operators
1	(sign), + (sign), !
2	%
3	* , /
4	- , +
5	> , < , >= , <=
6	== , !=
7	&&
8	||

(Image reference: Page 4)


Boolean NOT
(input::BOOLEAN) -> output::BOOLEAN

!true  //=> false
!false //=> true

Modulo
(dividend::INTEGER, divisor::INTEGER) -> remainder::INTEGER

Multiplication

Works with INTEGER or STRING repetition.

Division

Integer quotient only.

Addition / Subtraction

INTEGER arithmetic or STRING concatenation.

Comparisons

INTEGER → BOOLEAN
STRING → BOOLEAN
BOOLEAN → BOOLEAN

Functions
max
(op1::INTEGER, op2::INTEGER, ...) -> result::INTEGER

min
(op1::INTEGER, op2::INTEGER, ...) -> result::INTEGER

concat
(op1::STRING, op2::STRING, ...) -> STRING

len
(input::STRING) -> INTEGER

maxlen

Known before runtime.

trunc
(input::STRING, max_length::INTEGER) -> STRING

replace
(input::STRING, old::STRING, new::STRING) -> STRING

int2str
(input::INTEGER) -> STRING

pack

Binary representation of integers:

"int64le"

"int32le"

"int8"

pad

Ensures string length is a multiple of quantum.

escape

Escapes string per Autopilot/Pilot encoding.

Conditionals

Three forms:

Basic tack-on:
if condition then
    <statements>
end

tack-on with else:
if condition then
    <statements>
else
    <statements>
end

weave-in (produces values):
if condition then
    <statements>
    expression::<output_type>
else
    <statements>
    expression::<output_type>
end -> output_label::<output_type>


(Image reference: Page 7)


Final Notes

“This is but a tiny taste of the possibilities created by conditional statements. More examples will follow in future.”